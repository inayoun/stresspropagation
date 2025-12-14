import json
import random
from pathlib import Path
import numpy as np
import pandas as pd

DATA_DIR = Path('data_interim')
CAL_FILE = DATA_DIR / 'calibration.json'
NODE_KEYS = [
    'node_cardiac_rhythm', 'node_heart_rate', 'node_breathing_rate', 'node_breathing_depth',
    'node_sweat_level', 'node_sweat_reactivity', 'node_skin_temperature', 'node_muscle_tension'
]

RANGE_CHECKS = {
    'node_heart_rate': (40.0, 200.0),
    'node_breathing_rate': (6.0, 30.0),
    'node_skin_temperature': (25.0, 38.0),
}

PRECISION_TOLS = {
    'node_heart_rate': 0.05,
    'node_skin_temperature': 0.01,
    'node_sweat_level': 1e-3,
    'node_muscle_tension': 1e-3,
}

def forward_transform(x, meta):
    if meta['transform'] == 'log1p':
        return np.log1p(np.clip(x, a_min=0, a_max=None))
    return x

def inverse_transform(xp, meta):
    if meta['inverse'] == 'expm1':
        return np.expm1(xp)
    return xp

def main():
    with open(CAL_FILE) as f:
        cal = json.load(f)
    metas = cal['nodes']


    feats = []
    for fp in DATA_DIR.glob('features_*.parquet'):
        df = pd.read_parquet(fp)
        df['__subject'] = fp.stem.split('_')[1]
        feats.append(df)
    all_df = pd.concat(feats, ignore_index=True)


    zcols = []
    for k in NODE_KEYS:
        zcols += [f'{k}_level_z', f'{k}_slope_z', f'{k}_accel_z']
    if all_df[zcols].isna().any().any():
        missing = all_df[zcols].isna().sum().sum()
        raise AssertionError(f'NaNs found in z fields: {missing}')


    for k, (lo, hi) in RANGE_CHECKS.items():
        raw = all_df[k].to_numpy()
        if np.nanmin(raw) < lo - 1e-6 or np.nanmax(raw) > hi + 1e-6:
            raise AssertionError(f'Range violation for {k}: [{np.nanmin(raw)}, {np.nanmax(raw)}] not within [{lo}, {hi}]')


    for k in NODE_KEYS:
        meta = metas[k]
        x = all_df[k].astype(float).to_numpy()
        xp = forward_transform(x, meta)
        z = (xp - meta['mu']) / (meta['sigma'] + 1e-12)
        m = float(np.nanmean(z))
        s = float(np.nanstd(z))
        if abs(m) > 0.1 or abs(s - 1.0) > 0.1:
            raise AssertionError(f'Global z stats off for {k}: mean={m:.3f}, std={s:.3f}')


    samples = all_df.sample(n=min(1000, len(all_df)), random_state=42)
    for k in NODE_KEYS:
        meta = metas[k]
        raw = samples[k].astype(float).to_numpy()
        xp = forward_transform(raw, meta)
        z = (xp - meta['mu']) / (meta['sigma'] + 1e-12)

        xp_hat = z * meta['sigma'] + meta['mu']
        raw_hat = inverse_transform(xp_hat, meta)
        if k in ('node_heart_rate',):
            err = np.nanmax(np.abs(raw_hat - raw))
            if err > PRECISION_TOLS['node_heart_rate']:
                raise AssertionError(f'HR closure error {err} > tol')
        elif k in ('node_skin_temperature',):
            err = np.nanmax(np.abs(raw_hat - raw))
            if err > PRECISION_TOLS['node_skin_temperature']:
                raise AssertionError(f'Temp closure error {err} > tol')
        elif k in ('node_sweat_level','node_muscle_tension'):

            xp_err = np.nanmax(np.abs(xp_hat - xp))
            rel_err = np.nanmax(np.abs(raw_hat - raw) / np.maximum(1.0, np.abs(raw)))
            if xp_err > 1e-6 or rel_err > PRECISION_TOLS[k]:
                raise AssertionError(f'{k} closure xp_err={xp_err}, rel_err={rel_err}')
        else:

            rel_err = np.nanmax(np.abs(raw_hat - raw) / np.maximum(1.0, np.abs(raw)))
            if rel_err > 1e-3:
                raise AssertionError(f'{k} relative closure error {rel_err}')

        z2 = (forward_transform(raw_hat, meta) - meta['mu']) / (meta['sigma'] + 1e-12)
        zc = np.nanmax(np.abs(z2 - z))
        if zc > 1e-6:
            raise AssertionError(f'{k} z-domain closure error {zc}')

    print('feature extraction validation passed: all checks OK')

if __name__ == '__main__':
    main()
