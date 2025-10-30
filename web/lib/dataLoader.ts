export type GroupAPI = {
  version: string
  nodes: { id: string; system: string }[]
  calibration: { nodes: Record<string, { units: string; transform: string; inverse: string; precision: number; mu: number; sigma: number }> }
  conditions: Record<string, {
    static: {
      nodes: Record<string, { level: number; slope: number; accel: number; var: number }>
      edges: Record<string, { static_conn: number; sync_rate: number; significant: boolean }>
    }
    series: {
      t: number[]
      nodes: Record<string, { level: number[]; slope: number[]; var: number[] }>
      edges: Record<string, { sync: number[]; conf: number[] }>
    }
  }>
  static_raw: Record<string, Record<string, number>>
}

export async function fetchGroupJSON(path?: string): Promise<GroupAPI> {
  const base = (import.meta as any).env?.BASE_URL || '/'
  const url = (path ?? (base + 'group.json')) as string
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`)
  return await res.json()
}
