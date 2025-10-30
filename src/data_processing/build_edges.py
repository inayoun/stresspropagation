import math
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List, Tuple

SAMPLE_RATE = 4.0
ALPHA = 1 - math.exp(-1/5.0)  # EMA ~ tau 5 windows
THETA = 0.25
C_MIN = 0.25
N_ON = 3
M_OFF = 2

NODE_IDS = [
    ("Cardiac Rhythm", "node_cardiac_rhythm"),
    ("Heart Rate", "node_heart_rate"),
    ("Breathing Rate", "node_breathing_rate"),
    ("Breathing Depth", "node_breathing_depth"),
    ("Sweat Level", "node_sweat_level"),
    ("Sweat Reactivity", "node_sweat_reactivity"),
    ("Skin Temperature", "node_skin_temperature"),
    ("Muscle Tension", "node_muscle_tension"),
]

EDGE_KEYS: List[Tuple[int,int,str]] = []
for i in range(len(NODE_IDS)):
    for j in range(i+1, len(NODE_IDS)):
        a = NODE_IDS[i][0]
        b = NODE_IDS[j][0]
        EDGE_KEYS.append((i, j, f"{a}|{b}"))


def scale_slopes_per_condition(df: pd.DataFrame) -> pd.DataFrame:
    # Compute per-node slopes already present: {key}_slope_z
    # Scale within condition by P95(|slope|) with epsilon guard
    out = df.copy()
    eps = 1e-6
    for _, node_key in NODE_IDS:
        s_col = f"{node_key}_slope_z"
        if s_col not in out.columns:
            out[s_col] = 0.0
        for cond in [1,2,3,4]:
            m = out['label'] == cond
            if not m.any():
                continue
            denom = np.nanpercentile(np.abs(out.loc[m, s_col].astype(float)), 95)
            denom = float(denom) if np.isfinite(denom) and denom > 0 else 1.0
            out.loc[m, s_col+"_scaled"] = out.loc[m, s_col].astype(float) / (denom + eps)
    # Fill others
    for _, node_key in NODE_IDS:
        col = f"{node_key}_slope_z_scaled"
        if col not in out.columns:
            out[col] = 0.0
        out[col] = out[col].fillna(0.0).clip(-10, 10)
    return out


def compute_sync_and_conf(scaled: pd.DataFrame, start_idx: pd.Series, end_idx: pd.Series) -> pd.DataFrame:
    # For each edge and window compute sync and conf EMA of |sync|
    rows = []
    conf_state: Dict[str, float] = {ek: 0.0 for _,_,ek in EDGE_KEYS}
    hits: Dict[str, int] = {ek: 0 for _,_,ek in EDGE_KEYS}
    misses: Dict[str, int] = {ek: 0 for _,_,ek in EDGE_KEYS}
    visible: Dict[str, bool] = {ek: False for _,_,ek in EDGE_KEYS}

    for idx, row in scaled.iterrows():
        t_mid = float((start_idx.iloc[idx] + end_idx.iloc[idx]) / 2.0 / SAMPLE_RATE)
        cond = int(row['label'])
        # build slope vector
        svals = []
        for _, node_key in NODE_IDS:
            svals.append(float(row.get(f"{node_key}_slope_z_scaled", 0.0)))
        s = np.array(svals, dtype=float)
        for i, j, ekey in EDGE_KEYS:
            prod = s[i] * s[j]
            mag = math.sqrt(abs(prod))
            sync = math.copysign(mag, prod) if mag > 0 else 0.0
            sync = float(np.clip(sync, -1.0, 1.0))
            conf_state[ekey] = (1-ALPHA)*conf_state[ekey] + ALPHA*abs(sync)
            # gate
            if abs(sync) >= THETA and conf_state[ekey] >= C_MIN:
                hits[ekey] += 1
                misses[ekey] = 0
                if not visible[ekey] and hits[ekey] >= N_ON:
                    visible[ekey] = True
            else:
                misses[ekey] += 1
                hits[ekey] = 0
                if visible[ekey] and misses[ekey] >= M_OFF:
                    visible[ekey] = False
            rows.append({
                'window_idx': int(idx),
                't_mid': t_mid,
                'condition': cond,
                'edge_key': ekey,
                'sync': sync,
                'conf': float(conf_state[ekey]),
                'visible': bool(visible[ekey])
            })
    return pd.DataFrame(rows)


def process_subject(subject_id: str, processed_dir: Path, interim_dir: Path):
    feats_path = interim_dir / f"features_{subject_id}.parquet"
    meta_path = Path('data_processed') / f"windows_{subject_id}.parquet"
    if not feats_path.exists() or not meta_path.exists():
        print(f"Skipping {subject_id}: missing features or windows metadata")
        return
    feats = pd.read_parquet(feats_path)
    meta = pd.read_parquet(meta_path)
    feats = feats.sort_values('window_id').reset_index(drop=True)
    meta = meta.sort_values('window_id').reset_index(drop=True)
    scaled = scale_slopes_per_condition(pd.concat([feats[['label'] + [c for c in feats.columns if c.endswith('_slope_z')]]], axis=1))
    edges_df = compute_sync_and_conf(scaled, meta['start_idx'], meta['end_idx'])
    edges_df.insert(0, 'subject', subject_id)
    out_path = interim_dir / f"edges_{subject_id}.parquet"
    edges_df.to_parquet(out_path)
    print(f"Saved edges for {subject_id} -> {out_path}")


def main():
    processed_dir = Path('data_processed')
    interim_dir = Path('data_interim')
    interim_dir.mkdir(parents=True, exist_ok=True)
    subjects = sorted([p.stem.split('_')[1] for p in interim_dir.glob('features_*.parquet') if 'S7' not in p.stem])
    for sid in subjects:
        process_subject(sid, processed_dir, interim_dir)

if __name__ == '__main__':
    main()
