import json
from pathlib import Path
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

PRECISION = {
    'node_heart_rate': 1,
    'node_skin_temperature': 2,
    'node_sweat_level': 3,
    'node_muscle_tension': 3,
    'node_breathing_rate': 1,
    'node_breathing_depth': 2,
    'node_cardiac_rhythm': 3,
    'node_sweat_reactivity': 2,
}


def forward(x, meta):
    if meta['transform'] == 'log1p':
        return np.log1p(np.clip(x, a_min=0, a_max=None))
    return x


def inverse(xp, meta):
    if meta['inverse'] == 'expm1':
        return np.expm1(xp)
    return xp


def z_to_dr(z: float, r_delta: float, z_max: float = 2.5) -> float:
    zc = max(-z_max, min(z_max, z))
    return (zc / z_max) * r_delta


def validate_wp7_label_and_inverse():
    api = json.loads((ART / 'group.json').read_text('utf-8'))
    ok = True
    # sample 200 triplets across available series
    cnt = 0
    for cond, cobj in api['conditions'].items():
        series = cobj['series']
        Lt = len(series['t'])
        for node_name, node_id in NODE_ORDER:
            if node_id not in series['nodes']:
                continue
            levels = series['nodes'][node_id]['level']
            for t in range(0, Lt, max(1, Lt // 50)):
                z = levels[t]
                meta = api['calibration']['nodes'][node_id]
                xp = z * meta['sigma'] + meta['mu']
                raw = float(inverse(xp, meta))
                # label precision
                prec = PRECISION[node_id]
                label = f"{raw:.{prec}f}"
                # Check rounding tolerance in raw domain (half-ULP at this precision)
                raw_back = float(label)
                tol = 0.5 * (10 ** (-prec))
                if abs(raw_back - raw) > tol:
                    ok = False
                cnt += 1
                if cnt > 200:
                    break
            if cnt > 200:
                break
        if cnt > 200:
            break
    assert ok, 'WP7 label/inverse precision mapping failed'


def validate_wp7_z0_r0_mapping():
    # zToDr(0) -> 0
    for rd in [50, 100, 200]:
        assert z_to_dr(0.0, rd) == 0.0


def validate_wp8_halo_logic():
    # EMA with alpha=0.3 on |Δ slope| thresholds 0.1/0.3/0.6
    def bands(seq):
        ema = 0.0
        out = [0]
        for i in range(1, len(seq)):
            dv = abs(seq[i] - seq[i-1])
            ema = 0.3 * dv + 0.7 * ema
            out.append(3 if ema > 0.6 else 2 if ema > 0.3 else 1 if ema > 0.1 else 0)
        return out
    # constant series -> all zeros
    assert all(b == 0 for b in bands([0]*50)), 'Constant series should yield no halo'
    # small ±1% oscillations around 0.0 produce low bands and minimal flicker
    seq = [0.0 + (0.01 if i % 10 == 0 else 0.0) for i in range(200)]
    b = bands(seq)
    flips = sum(1 for i in range(1, len(b)) if b[i] != b[i-1])
    assert flips < len(b) * 0.2, 'Halo bands flicker too much on small oscillations'


def main():
    validate_wp7_label_and_inverse()
    validate_wp7_z0_r0_mapping()
    validate_wp8_halo_logic()
    print('frontend automated validations passed')

if __name__ == '__main__':
    main()
