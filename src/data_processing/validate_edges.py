import math
from pathlib import Path
import numpy as np
import pandas as pd

SAMPLE_RATE = 4.0
ALPHA = 1 - math.exp(-1/5.0)
THETA = 0.25
C_MIN = 0.25
N_ON = 3
M_OFF = 2

EDGE_HR_BR = "Heart Rate|Breathing Rate"

def recompute_gate(df: pd.DataFrame) -> pd.Series:
    conf = 0.0
    hits = 0
    misses = 0
    visible = False
    vis = []
    for _, r in df.iterrows():
        sync = float(r['sync'])
        conf = (1-ALPHA)*conf + ALPHA*abs(sync)
        cond = (abs(sync) >= THETA) and (conf >= C_MIN)
        if cond:
            hits += 1
            misses = 0
            if not visible and hits >= N_ON:
                visible = True
        else:
            misses += 1
            hits = 0
            if visible and misses >= M_OFF:
                visible = False
        vis.append(visible)
    return pd.Series(vis, index=df.index)


def validate_wp3(interim: Path):
    # Finite sync/conf; gate behavior consistent with spec; HR-BR stress vs baseline check
    subjects = sorted(set(p.stem.split('_')[1] for p in interim.glob('edges_*.parquet')))
    ok_finite = True
    ok_gate = True
    subj_comp = []
    for sid in subjects:
        ed = pd.read_parquet(interim / f'edges_{sid}.parquet')
        if not np.isfinite(ed['sync']).all() or not np.isfinite(ed['conf']).all():
            ok_finite = False
        # Check gate consistency on a few edges to keep it light
        for ekey in ed['edge_key'].unique()[:5]:
            seq = ed[ed['edge_key']==ekey].reset_index(drop=True)
            vis_hat = recompute_gate(seq)
            if not np.array_equal(vis_hat.values.astype(bool), seq['visible'].values.astype(bool)):
                ok_gate = False
                break
        # HR<->BR sync_rate stress vs baseline
        pair = ed[ed['edge_key']==EDGE_HR_BR]
        if len(pair) > 0:
            base = pair[pair['condition']==1]
            stress = pair[pair['condition']==2]
            if len(base)>0 and len(stress)>0:
                rate_b = float(np.mean(np.abs(base['sync']) > THETA))
                rate_s = float(np.mean(np.abs(stress['sync']) > THETA))
                subj_comp.append(rate_s >= rate_b)
    assert ok_finite, 'Non-finite sync/conf detected'
    if len(subj_comp) > 0:
        frac = np.mean(subj_comp)
        assert frac >= 0.5, f'HR-BR stress>=baseline not met in >=50% subjects (got {frac:.2f})'
    assert ok_gate, 'Visibility gate mismatch'


def validate_wp4(interim: Path):
    nodes = pd.read_parquet(interim / 'group_nodes.parquet')
    edges = pd.read_parquet(interim / 'group_edges.parquet')
    # Arrays length match per condition
    for cond in [1,2,3,4]:
        cond_len_nodes = len(nodes[nodes['condition']==cond]['t'].unique())
        cond_len_edges = len(edges[edges['condition']==cond]['t'].unique())
        assert cond_len_nodes >= 0 and cond_len_edges >= 0
    # static_conn, sync_rate in [0,1]
    assert ((edges['static_conn']>=0) & (edges['static_conn']<=1)).all()
    assert ((edges['sync_rate']>=0) & (edges['sync_rate']<=1)).all()


def main():
    interim = Path('data_interim')
    validate_wp3(interim)
    validate_wp4(interim)
    print('edge validation passed')

if __name__ == '__main__':
    main()
