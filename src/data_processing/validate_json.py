import json
import random
from pathlib import Path
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd

ART = Path('artifacts/api')
INT = Path('data_interim')

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

PRECISION_TOLS = {
    'node_heart_rate': 0.05,
    'node_skin_temperature': 0.01,
    'node_sweat_level': 1e-3,
    'node_muscle_tension': 1e-3,
}


def forward(x, meta):
    if meta['transform'] == 'log1p':
        return np.log1p(np.clip(x, a_min=0, a_max=None))
    return x

def inverse(xp, meta):
    if meta['inverse'] == 'expm1':
        return np.expm1(xp)
    return xp


def load_api() -> Dict:
    with open(ART / 'group.json', 'r', encoding='utf-8') as f:
        api = json.load(f)
    return api


def check_lengths(api: Dict):
    for cond, cobj in api['conditions'].items():
        t = cobj['series']['t']
        Lt = len(t)
        for ekey, es in cobj['series']['edges'].items():
            assert len(es['sync']) == len(es['conf']) == Lt, f"Length mismatch for cond={cond} edge={ekey}"


def sample_triplets(api: Dict, n=200) -> List[Tuple[int, str, int]]:

    candidates = []
    for cond, cobj in api['conditions'].items():
        Lt = len(cobj['series']['t'])
        for k in NODE_IDS:
            if k in cobj['series']['nodes']:
                candidates.extend([(int(cond), k, t) for t in range(Lt)])
    if not candidates:
        return []
    random.seed(42)
    return random.sample(candidates, min(n, len(candidates)))


def rebuild_raw_hat(api: Dict, cond: int, node_id: str, t: int) -> float:
    meta = api['calibration']['nodes'][node_id]
    z = api['conditions'][str(cond)]['series']['nodes'][node_id]['level'][t]
    xp_hat = z * meta['sigma'] + meta['mu']
    raw_hat = inverse(xp_hat, meta)
    return float(raw_hat)


def group_raw_from_parquet_via_z(cond: int, node_id: str, t: int, meta: Dict) -> float:

    zs = []
    for fp in INT.glob('features_*.parquet'):
        df = pd.read_parquet(fp).sort_values('window_id').reset_index(drop=True)
        cdf = df[df['label']==cond].copy().reset_index(drop=True)
        if t < len(cdf):
            raw = float(cdf.loc[t, node_id])
            xp = forward(raw, meta)
            z = (xp - meta['mu']) / (meta['sigma'] + 1e-12)
            zs.append(z)
    if not zs:
        return float('nan')
    z_mean = float(np.nanmean(zs))
    xp_hat = z_mean * meta['sigma'] + meta['mu']
    return float(inverse(xp_hat, meta))


def validate_reconstruction(api: Dict):
    triplets = sample_triplets(api, n=200)
    for cond, node_id, t in triplets:
        raw_hat = rebuild_raw_hat(api, cond, node_id, t)
        meta = api['calibration']['nodes'][node_id]
        raw_true = group_raw_from_parquet_via_z(cond, node_id, t, meta)
        if node_id == 'node_heart_rate':
            err = abs(raw_hat - raw_true)
            assert err <= PRECISION_TOLS['node_heart_rate'], f"HR err {err} > tol"
        elif node_id == 'node_skin_temperature':
            err = abs(raw_hat - raw_true)
            assert err <= PRECISION_TOLS['node_skin_temperature'], f"Temp err {err} > tol"
        elif node_id in ('node_sweat_level','node_muscle_tension'):

            rel_err = abs(raw_hat - raw_true) / max(1.0, abs(raw_true))
            assert rel_err <= PRECISION_TOLS[node_id], f"{node_id} rel_err={rel_err}"
        else:
            rel_err = abs(raw_hat - raw_true) / max(1.0, abs(raw_true))
            assert rel_err <= 1e-3, f"{node_id} rel_err {rel_err} > 1e-3"


def main():
    api = load_api()
    check_lengths(api)
    validate_reconstruction(api)
    print('json validation passed')

if __name__ == '__main__':
    main()
