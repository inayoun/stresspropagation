import os
import pickle
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List, Tuple
from scipy import signal
import neurokit2 as nk
import pyarrow.parquet as pq
import pyarrow as pa


TARGET_FS = 4
WINDOW_LENGTH = 60
WINDOW_HOP = 30
VALID_LABELS = {1, 2, 3, 4}
MIN_AGREEMENT = 0.8

def load_wesad_data(subject_dir: Path) -> Tuple[Dict, Dict]:
    """Load WESAD data for a single subject."""
    pkl_file = next(subject_dir.glob("S*.pkl"))
    with open(pkl_file, 'rb') as f:
        data = pickle.load(f, encoding='latin1')
    return data

def resample_signal(signal_data: np.ndarray, orig_fs: float, target_fs: float) -> np.ndarray:
    """Resample signal to target frequency."""

    if signal_data.ndim > 1:
        signal_data = signal_data.squeeze()
    
    if orig_fs == target_fs:
        return signal_data
    
    num_samples = int(len(signal_data) * target_fs / orig_fs)
    return signal.resample(signal_data, num_samples)

def process_subject(subject_dir: Path, output_dir: Path):
    """Process data for a single subject."""
    subject_id = subject_dir.name
    print(f"Processing subject {subject_id}...")
    

    data = load_wesad_data(subject_dir)
    

    labels = data['label']
    

    signals = {}
    

    chest_signals = data['signal']['chest']
    chest_fs = 700
    

    if 'ECG' in chest_signals:
        ecg = chest_signals['ECG']
        ecg_resampled = resample_signal(ecg, chest_fs, TARGET_FS)
        signals['ecg'] = ecg_resampled
    

    if 'EMG' in chest_signals:
        emg = chest_signals['EMG']
        emg_resampled = resample_signal(emg, chest_fs, TARGET_FS)
        signals['emg'] = emg_resampled
    

    if 'EDA' in chest_signals:
        eda_chest = chest_signals['EDA']
        eda_chest_resampled = resample_signal(eda_chest, chest_fs, TARGET_FS)
        signals['eda_chest'] = eda_chest_resampled
    

    if 'Resp' in chest_signals:
        resp = chest_signals['Resp']
        resp_resampled = resample_signal(resp, chest_fs, TARGET_FS)
        signals['resp'] = resp_resampled
    

    if 'Temp' in chest_signals:
        temp_chest = chest_signals['Temp']
        temp_chest_resampled = resample_signal(temp_chest, chest_fs, TARGET_FS)
        signals['temp_chest'] = temp_chest_resampled
    

    wrist_signals = data['signal']['wrist']
    

    if 'EDA' in wrist_signals:
        eda_wrist = wrist_signals['EDA']
        eda_wrist_resampled = resample_signal(eda_wrist, 4, TARGET_FS)
        signals['eda_wrist'] = eda_wrist_resampled
    

    if 'TEMP' in wrist_signals:
        temp_wrist = wrist_signals['TEMP']
        temp_wrist_resampled = resample_signal(temp_wrist, 4, TARGET_FS)
        signals['temp_wrist'] = temp_wrist_resampled
    

    if 'BVP' in wrist_signals:
        bvp = wrist_signals['BVP']
        bvp_resampled = resample_signal(bvp, 64, TARGET_FS)
        signals['bvp'] = bvp_resampled
    

    num_samples = len(next(iter(signals.values())))
    time_index = pd.timedelta_range(start=0, periods=num_samples, freq=f"{1000/TARGET_FS}ms")
    

    df = pd.DataFrame(signals, index=time_index)
    

    label_indices = np.linspace(0, len(labels) - 1, num=len(df), dtype=int)
    df['label'] = labels[label_indices]
    

    output_file = output_dir / f"subject_{subject_id}_4hz.parquet"
    df.to_parquet(output_file)
    print(f"Saved resampled data to {output_file}")
    

    window_size = WINDOW_LENGTH * TARGET_FS
    hop_size = WINDOW_HOP * TARGET_FS
    
    windows = []
    window_metadata = []
    
    for start in range(0, len(df) - window_size + 1, hop_size):
        end = start + window_size
        window = df.iloc[start:end].copy()
        

        labels_in_window = window['label'].values
        unique_labels, counts = np.unique(labels_in_window, return_counts=True)
        majority_label = unique_labels[np.argmax(counts)]
        agreement = np.max(counts) / len(labels_in_window)
        

        if majority_label in VALID_LABELS and agreement >= MIN_AGREEMENT:

            windows.append(window.drop(columns=['label']))
            

            window_metadata.append({
                'window_id': len(windows) - 1,
                'subject_id': subject_id,
                'start_idx': start,
                'end_idx': end,
                'label': int(majority_label),
                'label_agreement': float(agreement)
            })
    

    if window_metadata:
        metadata_df = pd.DataFrame(window_metadata)
        metadata_file = output_dir / f"windows_{subject_id}.parquet"
        metadata_df.to_parquet(metadata_file)
        print(f"Saved window metadata to {metadata_file}")
        

        for i, window in enumerate(windows):
            window_file = output_dir / f"window_{subject_id}_{i:04d}.parquet"
            window.to_parquet(window_file)
        
        print(f"Saved {len(windows)} windows for subject {subject_id}")
    else:
        print(f"No valid windows found for subject {subject_id}")

def main():

    data_dir = Path("data_raw/WESAD")
    output_dir = Path("data_processed")
    output_dir.mkdir(parents=True, exist_ok=True)
    

    subject_dirs = sorted([d for d in data_dir.glob("S*") if d.is_dir()])
    
    for subject_dir in subject_dirs:
        try:
            process_subject(subject_dir, output_dir)
        except Exception as e:
            print(f"Error processing {subject_dir}: {e}")

if __name__ == "__main__":
    main()
