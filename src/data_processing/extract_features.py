import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List, Tuple
import neurokit2 as nk
from scipy import signal
import json
import os
import pickle

SAMPLE_RATE = 4
RAW_FS_CHEST = 700.0
RAW_FS_BVP = 64.0
WINDOW_SIZE = 60 * SAMPLE_RATE

FREQ_BANDS = {
    'hf': (0.15, 0.4),
}

def load_window_data(subject_id: str, window_id: int, data_dir: Path) -> pd.DataFrame:
    """Load window data for a subject."""
    window_file = data_dir / f"window_{subject_id}_{window_id:04d}.parquet"
    return pd.read_parquet(window_file)

def load_windows_metadata(subject_id: str, data_dir: Path) -> pd.DataFrame:
    """Load windows metadata for a subject."""
    metadata_file = data_dir / f"windows_{subject_id}.parquet"
    return pd.read_parquet(metadata_file)

def calculate_hrv_from_raw_ecg(ecg_signal_raw: np.ndarray) -> Dict:
    """Calculate HR/IBI/HRV metrics from raw ECG at 700 Hz for a window."""
    try:
        if ecg_signal_raw.ndim > 1:
            ecg_signal_raw = ecg_signal_raw.squeeze()
        ecg_cleaned = nk.ecg_clean(ecg_signal_raw, sampling_rate=RAW_FS_CHEST)
        _, rpeaks = nk.ecg_peaks(ecg_cleaned, sampling_rate=RAW_FS_CHEST)
        r_idx = rpeaks.get('ECG_R_Peaks')
        if r_idx is None or len(r_idx) < 2:
            return {'hr_bpm': np.nan, 'rmssd_ms': np.nan, 'hf_power': np.nan}
        ibi_s = np.diff(r_idx) / RAW_FS_CHEST
        hr_bpm = 60.0 / np.mean(ibi_s)
        rmssd_ms = np.sqrt(np.mean(np.diff(ibi_s) ** 2)) * 1000.0
        hrv_freq = nk.hrv_frequency(rpeaks, sampling_rate=RAW_FS_CHEST, show=False)
        hf_power = float(hrv_freq['HRV_HF'].iloc[0]) if not hrv_freq.empty else np.nan
        return {'hr_bpm': float(hr_bpm), 'rmssd_ms': float(rmssd_ms), 'hf_power': hf_power}
    except Exception as e:
        print(f"Error calculating HRV features: {e}")
        return {'hr_bpm': np.nan, 'rmssd_ms': np.nan, 'hf_power': np.nan}

def calculate_resp_features(resp_signal: np.ndarray, sample_rate: float) -> Dict:
    """Calculate respiratory features."""
    try:
        peaks, _ = signal.find_peaks(resp_signal, distance=sample_rate*0.8)
        
        if len(peaks) > 1:
            bbi = np.diff(peaks) / sample_rate
            resp_rate = 60 / np.mean(bbi)
            resp_amplitude = np.mean(np.abs(signal.hilbert(resp_signal)))
            
            return {
                'resp_rate': float(resp_rate),
                'resp_amplitude': float(resp_amplitude),
                'resp_rmssd': float(np.sqrt(np.mean(np.diff(bbi) ** 2)))
            }
        return {'resp_rate': np.nan, 'resp_amplitude': np.nan, 'resp_rmssd': np.nan}
    except Exception as e:
        print(f"Error calculating respiratory features: {e}")
        return {'resp_rate': np.nan, 'resp_amplitude': np.nan, 'resp_rmssd': np.nan}

def calculate_eda_features(eda_signal: np.ndarray, sample_rate: float) -> Dict:
    """Calculate EDA tonic mean and SCRs/min using NeuroKit at 4 Hz (or available fs)."""
    try:
        if eda_signal.ndim > 1:
            eda_signal = eda_signal.squeeze()
        eda_signal = np.asarray(eda_signal, dtype=float)
        signals, info = nk.eda_process(eda_signal, sampling_rate=sample_rate)
        tonic_mean = float(np.mean(signals['EDA_Tonic']))
        scr_mask = info.get('SCR_Peaks')
        scr_count = int(np.sum(scr_mask)) if scr_mask is not None else 0
        duration_min = len(eda_signal) / sample_rate / 60.0
        scr_per_min = float(scr_count / duration_min) if duration_min > 0 else np.nan
        return {'eda_tonic': tonic_mean, 'scr_per_min': scr_per_min}
    except Exception as e:
        print(f"Error calculating EDA features: {e}")
        return {'eda_tonic': np.nan, 'scr_per_min': np.nan}

def calculate_emg_envelope_from_raw(emg_signal_raw: np.ndarray) -> Dict:
    """Calculate EMG envelope metrics from raw 700 Hz EMG."""
    try:
        if emg_signal_raw.ndim > 1:
            emg_signal_raw = emg_signal_raw.squeeze()
        b, a = signal.butter(4, [20.0, 200.0], btype='bandpass', fs=RAW_FS_CHEST)
        emg_filtered = signal.filtfilt(b, a, emg_signal_raw)
        env = np.abs(signal.hilbert(emg_filtered))
        b2, a2 = signal.butter(4, 5.0, btype='lowpass', fs=RAW_FS_CHEST)
        env_lp = signal.filtfilt(b2, a2, env)
        return {
            'emg_envelope_mean': float(np.mean(env_lp)),
            'emg_envelope_std': float(np.std(env_lp))
        }
    except Exception as e:
        print(f"Error calculating EMG features: {e}")
        return {'emg_envelope_mean': np.nan, 'emg_envelope_std': np.nan}

def extract_window_features(subject_raw: dict, window_data: pd.DataFrame, t0_s: float, t1_s: float) -> Dict:
    """Extract features for the 8 nodes and side-panel metrics in a window."""
    features: Dict[str, float] = {}
    ecg_raw = subject_raw.get('ECG')
    if ecg_raw is not None:
        i0 = int(t0_s * RAW_FS_CHEST)
        i1 = int(t1_s * RAW_FS_CHEST)
        heart = calculate_hrv_from_raw_ecg(ecg_raw[i0:i1])
        features.update(heart)
    if 'resp' in window_data.columns:
        resp_features = calculate_resp_features(window_data['resp'].values, SAMPLE_RATE)
        features.update({'resp_rate': resp_features['resp_rate'], 'resp_amplitude': resp_features['resp_amplitude']})
    eda_col = 'eda_wrist' if 'eda_wrist' in window_data.columns else ('eda_chest' if 'eda_chest' in window_data.columns else None)
    if eda_col:
        eda_features = calculate_eda_features(window_data[eda_col].values, SAMPLE_RATE)
        features.update(eda_features)
    temp_col = 'temp_wrist' if 'temp_wrist' in window_data.columns else ('temp_chest' if 'temp_chest' in window_data.columns else None)
    if temp_col:
        temp_mean = float(np.mean(window_data[temp_col].values))
        features['temperature_mean'] = temp_mean
    emg_raw = subject_raw.get('EMG')
    if emg_raw is not None:
        i0 = int(t0_s * RAW_FS_CHEST)
        i1 = int(t1_s * RAW_FS_CHEST)
        emg_metrics = calculate_emg_envelope_from_raw(emg_raw[i0:i1])
        features.update(emg_metrics)
    if 'acc_chest' in window_data.columns:
        features['acc_chest_mag'] = float(np.mean(np.abs(window_data['acc_chest'].values)))
    if 'acc_wrist' in window_data.columns:
        features['acc_wrist_mag'] = float(np.mean(np.abs(window_data['acc_wrist'].values)))
    if 'bvp' in window_data.columns:
        features['bvp_mean'] = float(np.mean(window_data['bvp'].values))
    features['node_heart_rate'] = features.get('hr_bpm', np.nan)
    features['node_cardiac_rhythm'] = np.nansum([features.get('hf_power', np.nan),
                                                 features.get('rmssd_ms', np.nan)])
    features['node_breathing_rate'] = features.get('resp_rate', np.nan)
    features['node_breathing_depth'] = features.get('resp_amplitude', np.nan)
    features['node_sweat_level'] = features.get('eda_tonic', np.nan)
    features['node_sweat_reactivity'] = features.get('scr_per_min', np.nan)
    features['node_skin_temperature'] = features.get('temperature_mean', np.nan)
    features['node_muscle_tension'] = features.get('emg_envelope_mean', np.nan)
    if np.isfinite(features.get('node_heart_rate', np.nan)):
        features['node_heart_rate'] = float(np.clip(features['node_heart_rate'], 40.0, 200.0))
    if np.isfinite(features.get('node_breathing_rate', np.nan)):
        features['node_breathing_rate'] = float(np.clip(features['node_breathing_rate'], 6.0, 30.0))
    if np.isfinite(features.get('node_skin_temperature', np.nan)):
        features['node_skin_temperature'] = float(np.clip(features['node_skin_temperature'], 25.0, 38.0))
    return features

NODE_KEYS = [
    'node_cardiac_rhythm', 'node_heart_rate', 'node_breathing_rate', 'node_breathing_depth',
    'node_sweat_level', 'node_sweat_reactivity', 'node_skin_temperature', 'node_muscle_tension'
]

def compute_within_subject_dynamics(df: pd.DataFrame) -> pd.DataFrame:
    for key in NODE_KEYS:
        raw = df[key].astype(float)
        mu = raw.mean()
        sigma = raw.std()
        z_within = (raw - mu) / (sigma + 1e-12)
        slope = z_within.diff().fillna(0.0)
        accel = slope.diff().fillna(0.0)
        var_raw = raw.rolling(window=min(5, len(raw)), min_periods=1).std().fillna(0.0)
        df[f'{key}_slope_z'] = slope.replace([np.inf, -np.inf], 0.0)
        df[f'{key}_accel_z'] = accel.replace([np.inf, -np.inf], 0.0)
        df[f'{key}_var_raw'] = var_raw.replace([np.inf, -np.inf], 0.0)
    return df

def process_subject(subject_id: str, data_dir: Path, output_dir: Path, wesad_raw_dir: Path) -> Dict:
    """Process a single subject's data and extract features."""
    print(f"Processing features for subject {subject_id}...")
    try:
        windows_meta = load_windows_metadata(subject_id, data_dir)
    except FileNotFoundError:
        print(f"No windows found for subject {subject_id}")
        return {}

    all_features = []
    pkl_path = wesad_raw_dir / subject_id / f"{subject_id}.pkl"
    with open(pkl_path, 'rb') as f:
        wesad = pickle.load(f, encoding='latin1')
    subject_raw = {
        'ECG': wesad['signal']['chest'].get('ECG'),
        'EMG': wesad['signal']['chest'].get('EMG'),
    }
    for _, window_meta in windows_meta.iterrows():
        window_id = window_meta['window_id']
        
        try:
            window_data = load_window_data(subject_id, window_id, data_dir)
            t0_s = float(window_meta['start_idx']) / SAMPLE_RATE
            t1_s = float(window_meta['end_idx']) / SAMPLE_RATE
            feats = {
                'subject_id': subject_id,
                'window_id': int(window_id),
                'label': int(window_meta['label']),
                'label_agreement': float(window_meta['label_agreement'])
            }
            feats.update(extract_window_features(subject_raw, window_data, t0_s, t1_s))
            all_features.append(feats)
        except Exception as e:
            print(f"Error processing window {window_id} for subject {subject_id}: {e}")
    
    if not all_features:
        return {}
    
    features_df = pd.DataFrame(all_features)
    features_df = compute_within_subject_dynamics(features_df)
    features_file = output_dir / f"features_{subject_id}.parquet"
    features_df.to_parquet(features_file)
    print(f"Saved features for subject {subject_id} to {features_file}")
    calib_source = {k: features_df[k].tolist() for k in NODE_KEYS}
    return {'features_path': str(output_dir / f"features_{subject_id}.parquet"), 'node_raw': calib_source}

def main():
    data_dir = Path("data_processed")
    output_dir = Path("data_interim")
    wesad_raw_dir = Path("data_raw/WESAD")
    output_dir.mkdir(parents=True, exist_ok=True)
    subject_dirs = sorted([d for d in data_dir.glob("subject_*_4hz.parquet") if 'S7' not in str(d)])
    pooled_node_values: Dict[str, list] = {k: [] for k in NODE_KEYS}
    subject_ids: List[str] = []
    for subject_file in subject_dirs:
        subject_id = subject_file.stem.split('_')[1]
        result = process_subject(subject_id, data_dir, output_dir, wesad_raw_dir)
        if not result:
            continue
        subject_ids.append(subject_id)
        for k in NODE_KEYS:
            pooled_node_values[k].extend([v for v in result['node_raw'][k] if pd.notna(v)])
    calibration = { 'nodes': {} }
    def node_spec(units: str, transform: str = 'identity', inverse: str = 'identity', precision: int = 2):
        return {'units': units, 'transform': transform, 'inverse': inverse, 'precision': precision}
    node_meta = {
        'node_heart_rate': node_spec('bpm', 'identity', 'identity', 1),
        'node_skin_temperature': node_spec('°C', 'identity', 'identity', 2),
        'node_breathing_rate': node_spec('breaths/min', 'identity', 'identity', 1),
        'node_breathing_depth': node_spec('a.u.', 'identity', 'identity', 2),
        'node_sweat_level': node_spec('µS', 'log1p', 'expm1', 3),
        'node_sweat_reactivity': node_spec('SCR/min', 'identity', 'identity', 2),
        'node_muscle_tension': node_spec('µV', 'log1p', 'expm1', 3),
        'node_cardiac_rhythm': node_spec('a.u.', 'identity', 'identity', 3),
    }
    # Compute mu/sigma in transformed space
    for k in NODE_KEYS:
        values = np.array(pooled_node_values[k], dtype=float)
        if node_meta[k]['transform'] == 'log1p':
            xprime = np.log1p(np.clip(values, a_min=0, a_max=None))
        else:
            xprime = values
        mu = float(np.nanmean(xprime))
        sigma = float(np.nanstd(xprime))
        calibration['nodes'][k] = {**node_meta[k], 'mu': mu, 'sigma': sigma}
    calibration_file = output_dir / "calibration.json"
    with open(calibration_file, 'w') as f:
        json.dump(calibration, f, indent=2)
    print(f"Saved global calibration to {calibration_file}")
    for subject_id in subject_ids:
        fpath = output_dir / f"features_{subject_id}.parquet"
        if not fpath.exists():
            continue
        sdf = pd.read_parquet(fpath)
        for k in NODE_KEYS:
            raw = sdf[k].astype(float)
            meta = calibration['nodes'][k]
            if meta['transform'] == 'log1p':
                xprime = np.log1p(np.clip(raw, a_min=0, a_max=None))
            else:
                xprime = raw
            level_z = (xprime - meta['mu']) / (meta['sigma'] + 1e-12)
            sdf[f'{k}_level_z'] = level_z.replace([np.inf, -np.inf], 0.0).fillna(0.0)
            for suffix in ['slope_z', 'accel_z', 'var_raw']:
                col = f'{k}_{suffix}'
                if col in sdf.columns:
                    sdf[col] = sdf[col].replace([np.inf, -np.inf], 0.0).fillna(0.0)
        sdf.to_parquet(fpath)
    print("Filled level_z for all subjects using global calibration.")

if __name__ == "__main__":
    main()
