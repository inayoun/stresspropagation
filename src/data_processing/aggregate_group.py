import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List, Tuple

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


def aggregate_nodes(interim_dir: Path) -> pd.DataFrame:
    # Create per-condition aligned series by truncating to the minimum subject count per condition
    feats_list = []
    for fp in interim_dir.glob('features_*.parquet'):
        df = pd.read_parquet(fp).sort_values('window_id')
        df['__subject'] = fp.stem.split('_')[1]
        feats_list.append(df)
    all_df = pd.concat(feats_list, ignore_index=True)
    out_rows = []
    for cond in [1,2,3,4]:
        cond_dfs = [df[df['label']==cond].copy().reset_index(drop=True) for df in feats_list]
        if len(cond_dfs) == 0:
            continue
        L = min(len(d) for d in cond_dfs)
        if L == 0:
            continue
        for t in range(L):
            row = {'condition': cond, 't': t}
            for _, key in NODE_IDS:
                row[f'{key}_level_z'] = float(np.nanmean([d.loc[t, f'{key}_level_z'] for d in cond_dfs]))
                row[f'{key}_slope_z'] = float(np.nanmean([d.loc[t, f'{key}_slope_z'] for d in cond_dfs]))
                row[f'{key}_var_raw']  = float(np.nanmean([d.loc[t, f'{key}_var_raw']  for d in cond_dfs]))
            out_rows.append(row)
    return pd.DataFrame(out_rows)


def aggregate_edges(interim_dir: Path) -> Tuple[pd.DataFrame, pd.DataFrame]:
    # concat edges across subjects
    edges_list = []
    for fp in interim_dir.glob('edges_*.parquet'):
        df = pd.read_parquet(fp)
        edges_list.append(df)
    all_edges = pd.concat(edges_list, ignore_index=True)
    # static metrics per condition and edge
    stat_rows = []
    for cond in [1,2,3,4]:
        cdf = all_edges[all_edges['condition']==cond]
        if len(cdf) == 0:
            continue
        for ekey in cdf['edge_key'].unique():
            ed = cdf[cdf['edge_key']==ekey]
            
            # Option B (current): mean of |sync| across all subjects and time windows
            static_conn_b = float(np.clip(np.nanmean(np.abs(ed['sync'])), 0, 1))
            
            # Option A: mean of |sync| across subjects at each time, then average over time
            # Group by time window, compute mean |sync| across subjects, then average those means
            if 't' in ed.columns or 'window_id' in ed.columns:
                time_col = 't' if 't' in ed.columns else 'window_id'
                temporal_means = ed.groupby(time_col)['sync'].apply(lambda x: np.nanmean(np.abs(x)))
                static_conn_a = float(np.clip(np.nanmean(temporal_means), 0, 1))
            else:
                # Fallback if no time column exists
                static_conn_a = static_conn_b
            
            sync_rate = float(np.nanmean(np.abs(ed['sync']) > 0.25))
            stat_rows.append({
                'condition': cond, 
                'edge_key': ekey, 
                'static_conn': static_conn_b,  # Keep original for backward compatibility
                'static_conn_temporal': static_conn_a,  # New temporal-aware version
                'sync_rate': sync_rate
            })
    stat_df = pd.DataFrame(stat_rows)
    # group series per condition by truncating to min count per subject
    series_rows = []
    for cond in [1,2,3,4]:
        cond_edges = [df[df['condition']==cond].copy().reset_index(drop=True) for df in edges_list]
        if len(cond_edges) == 0:
            continue
        # group by edge_key and align lengths
        keys = sorted(list(set().union(*[set(d['edge_key'].unique()) for d in cond_edges])))
        for ekey in keys:
            seqs = [d[d['edge_key']==ekey]['sync'].reset_index(drop=True) for d in cond_edges]
            L = min((len(s) for s in seqs), default=0)
            if L == 0:
                continue
            for t in range(L):
                series_rows.append({'condition': cond, 't': t, 'edge_key': ekey,
                                    'sync': float(np.nanmean([s.iloc[t] for s in seqs])),
                                    'conf': float(np.nanmean([d[d['edge_key']==ekey]['conf'].reset_index(drop=True).iloc[t] for d in cond_edges]))})
    series_df = pd.DataFrame(series_rows)
    return stat_df, series_df


def main():
    interim_dir = Path('data_interim')
    group_nodes = aggregate_nodes(interim_dir)
    stat_edges, series_edges = aggregate_edges(interim_dir)
    group_nodes.to_parquet(interim_dir / 'group_nodes.parquet')
    # merge static to series for convenience
    group_edges = series_edges.merge(stat_edges, on=['condition','edge_key'], how='left')
    group_edges.to_parquet(interim_dir / 'group_edges.parquet')
    print('Saved group_nodes.parquet and group_edges.parquet')
    
    # Print comparison of top edges by both metrics
    print('\n' + '='*80)
    print('COMPARISON: Top 10 Edges by static_conn (Option B) vs static_conn_temporal (Option A)')
    print('='*80)
    
    for cond in [1, 2, 3, 4]:
        cond_name = {1: 'Baseline', 2: 'Stress', 3: 'Amusement', 4: 'Meditation'}[cond]
        cond_stat = stat_edges[stat_edges['condition'] == cond].copy()
        
        print(f'\n{"─"*80}')
        print(f'CONDITION {cond}: {cond_name}')
        print(f'{"─"*80}')
        
        # Top 10 by Option B (current static_conn)
        print(f'\nTop 10 by Option B (mean |sync| across all subjects & time):')
        print(f'{"Rank":<6} {"Edge":<45} {"Opt B":<10} {"Opt A":<10} {"Diff":<10}')
        print('─'*80)
        top_b = cond_stat.nlargest(10, 'static_conn')
        for idx, (i, row) in enumerate(top_b.iterrows(), 1):
            diff = row['static_conn'] - row['static_conn_temporal']
            print(f'{idx:<6} {row["edge_key"]:<45} {row["static_conn"]:<10.4f} {row["static_conn_temporal"]:<10.4f} {diff:+.4f}')
        
        # Top 10 by Option A (temporal-aware)
        print(f'\nTop 10 by Option A (mean |sync| across subjects, then avg over time):')
        print(f'{"Rank":<6} {"Edge":<45} {"Opt A":<10} {"Opt B":<10} {"Diff":<10}')
        print('─'*80)
        top_a = cond_stat.nlargest(10, 'static_conn_temporal')
        for idx, (i, row) in enumerate(top_a.iterrows(), 1):
            diff = row['static_conn_temporal'] - row['static_conn']
            print(f'{idx:<6} {row["edge_key"]:<45} {row["static_conn_temporal"]:<10.4f} {row["static_conn"]:<10.4f} {diff:+.4f}')
    
    print('\n' + '='*80)

if __name__ == '__main__':
    main()
