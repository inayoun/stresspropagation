import json
import os
from pathlib import Path
from typing import Dict, List
import numpy as np
import pandas as pd

INTERIM = Path('data_interim')
ARTIFACTS = Path('artifacts/api')
ARTIFACTS.mkdir(parents=True, exist_ok=True)

NODE_ORDER = [
    ("Cardiac Rhythm", "node_cardiac_rhythm"),
    ("Heart Rate", "node_heart_rate"),
    ("Breathing Rate", "node_breathing_rate"),
    ("Breathing Depth", "node_breathing_depth"),
    ("Sweat Level", "node_sweat_level"),
    ("Sweat Reactivity", "node_sweat_reactivity"),
    ("Skin Temperature", "node_skin_temperature"),
    ("Muscle Tension", "node_muscle_tension"),
]
NODE_IDS = [k for _, k in NODE_ORDER]

HOP_SECONDS = 30  # from WP1: 60s win, 30s hop
MAX_MB = 3.0


def load_calibration() -> Dict:
    with open(INTERIM / 'calibration.json') as f:
        cal = json.load(f)
    return cal


def load_group() -> Dict[str, pd.DataFrame]:
    gnodes = pd.read_parquet(INTERIM / 'group_nodes.parquet')
    gedges = pd.read_parquet(INTERIM / 'group_edges.parquet')
    return {'nodes': gnodes, 'edges': gedges}


def compute_static_nodes(gnodes: pd.DataFrame) -> Dict[int, Dict[str, Dict[str, float]]]:
    out: Dict[int, Dict[str, Dict[str, float]]] = {}
    for cond in [1,2,3,4]:
        cd = gnodes[gnodes['condition']==cond].sort_values('t').reset_index(drop=True)
        if cd.empty:
            continue
        # approximate accel_z series from slope_z diff
        accel_cols = {}
        for _, k in NODE_ORDER:
            slope = cd[f'{k}_slope_z'].astype(float)
            accel = slope.diff().fillna(0.0)
            accel_cols[f'{k}_accel_z'] = accel
        # build static
        sn: Dict[str, Dict[str, float]] = {}
        for _, k in NODE_ORDER:
            sn[k] = {
                'level': float(cd[f'{k}_level_z'].astype(float).mean()),
                'slope': float(cd[f'{k}_slope_z'].astype(float).mean()),
                'accel': float(accel_cols[f'{k}_accel_z'].astype(float).mean()),
                'var': float(cd[f'{k}_var_raw'].astype(float).mean()),
            }
        out[cond] = sn
    return out


def build_series(gnodes: pd.DataFrame, gedges: pd.DataFrame) -> Dict[int, Dict]:
    series: Dict[int, Dict] = {}
    for cond in [1,2,3,4]:
        nd = gnodes[gnodes['condition']==cond].sort_values('t').reset_index(drop=True)
        ed = gedges[gedges['condition']==cond].sort_values('t').reset_index(drop=True)
        if nd.empty or ed.empty:
            continue
        t_max = int(nd['t'].max()) if 't' in nd else 0
        t = list((nd['t'].astype(int) * HOP_SECONDS).values)
        # nodes series
        nodes_series: Dict[str, Dict[str, List[float]]] = {}
        for _, k in NODE_ORDER:
            nodes_series[k] = {
                'level': list(nd[f'{k}_level_z'].astype(float).values),
                'slope': list(nd[f'{k}_slope_z'].astype(float).values),
                'var': list(nd[f'{k}_var_raw'].astype(float).values),
            }
        # edges series keyed by edge_key
        edges_series: Dict[str, Dict[str, List[float]]] = {}
        for ekey in sorted(ed['edge_key'].unique()):
            es = ed[ed['edge_key']==ekey].reset_index(drop=True)
            # ensure same length as t (truncate to min)
            L = min(len(t), len(es))
            edges_series[ekey] = {
                'sync': list(es['sync'].astype(float).values[:L]),
                'conf': list(es['conf'].astype(float).values[:L]),
            }
        series[cond] = {'t': t[:min(len(t), min((len(v['sync']) for v in edges_series.values()), default=len(t)))],
                        'nodes': nodes_series,
                        'edges': edges_series}
    return series


def compute_static_raw_means() -> Dict[int, Dict[str, float]]:
    # Average across subjects the per-condition raw means per node using features_{id}.parquet
    res: Dict[int, Dict[str, float]] = {1:{},2:{},3:{},4:{}}
    subj_files = list(INTERIM.glob('features_*.parquet'))
    per_cond_node: Dict[int, Dict[str, List[float]]] = {1:{},2:{},3:{},4:{}}
    for fp in subj_files:
        df = pd.read_parquet(fp)
        for cond in [1,2,3,4]:
            cdf = df[df['label']==cond]
            if cdf.empty:
                continue
            for _, k in NODE_ORDER:
                m = float(cdf[k].astype(float).mean())
                per_cond_node[cond].setdefault(k, []).append(m)
    for cond in [1,2,3,4]:
        for _, k in NODE_ORDER:
            vals = per_cond_node[cond].get(k, [])
            if len(vals) > 0:
                res[cond][k] = float(np.nanmean(vals))
    return res


def _json_default(o):
    try:
        import numpy as _np
        if isinstance(o, (_np.integer,)):
            return int(o)
        if isinstance(o, (_np.floating,)):
            return float(o)
    except Exception:
        pass
    if isinstance(o, (pd.Int64Dtype,)):
        return int(o)
    raise TypeError(f"Type not serializable: {type(o)}")

def maybe_chunk_and_write(payload: Dict):
    main_path = ARTIFACTS / 'group.json'
    s = json.dumps(payload, separators=(',', ':'), ensure_ascii=False, default=_json_default)
    size_mb = len(s.encode('utf-8')) / (1024*1024)
    if size_mb <= MAX_MB:
        with open(main_path, 'w', encoding='utf-8') as f:
            f.write(s)
        print(f'Wrote {main_path} ({size_mb:.2f} MB)')
        return
    # Too big: write series per condition as chunks
    base = ARTIFACTS
    payload_small = dict(payload)
    payload_small['conditions'] = {}
    for cond, cond_obj in payload['conditions'].items():
        cond_series = cond_obj.get('series', {})
        chunk_path = base / f'group_series_{cond}.json'
        with open(chunk_path, 'w', encoding='utf-8') as f:
            json.dump(cond_series, f, separators=(',', ':'), ensure_ascii=False, default=_json_default)
        cond_small = dict(cond_obj)
        cond_small.pop('series', None)
        cond_small['series_chunk'] = str(chunk_path.name)
        payload_small['conditions'][cond] = cond_small
    s2 = json.dumps(payload_small, separators=(',', ':'), ensure_ascii=False, default=_json_default)
    with open(main_path, 'w', encoding='utf-8') as f:
        f.write(s2)
    size_mb2 = len(s2.encode('utf-8')) / (1024*1024)
    print(f'Wrote {main_path} with chunks (~{size_mb2:.2f} MB)')


def main():
    cal = load_calibration()
    group = load_group()
    static_nodes = compute_static_nodes(group['nodes'])
    series = build_series(group['nodes'], group['edges'])
    static_raw = compute_static_raw_means()

    api = {
        'version': '2.0',
        'nodes': [{'id': k, 'system': name} for name, k in NODE_ORDER],
        'calibration': cal,
        'conditions': {}
    }
    for cond in [1,2,3,4]:
        if cond not in series or cond not in static_nodes:
            continue
        api['conditions'][cond] = {
            'static': {
                'nodes': static_nodes[cond],
                'edges': {ek: {'static_conn': float(group['edges'][(group['edges']['condition']==cond) & (group['edges']['edge_key']==ek)]['static_conn'].mean()),
                               'sync_rate': float(group['edges'][(group['edges']['condition']==cond) & (group['edges']['edge_key']==ek)]['sync_rate'].mean()),
                               'significant': False}  # placeholder, significance in later WP
                          for ek in group['edges'][group['edges']['condition']==cond]['edge_key'].unique()}
            },
            'series': {
                't': series[cond]['t'],
                'nodes': series[cond]['nodes'],
                'edges': series[cond]['edges']
            }
        }
    api['static_raw'] = static_raw

    maybe_chunk_and_write(api)

if __name__ == '__main__':
    main()
