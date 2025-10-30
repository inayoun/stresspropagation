import * as d3 from 'd3'
import { fetchGroupJSON, type GroupAPI } from '../lib/dataLoader'
import { zToDr, polar, buildSizeScale } from '../lib/scales'

type AppState = {
  playing: boolean
  timeIndex: number
  selectedNode?: string
  reducedMotion: boolean
  condition: number
}

const NODE_ORDER: { name: string; id: string }[] = [
  { name: 'Cardiac Rhythm', id: 'node_cardiac_rhythm' },
  { name: 'Heart Rate', id: 'node_heart_rate' },
  { name: 'Breathing Rate', id: 'node_breathing_rate' },
  { name: 'Breathing Depth', id: 'node_breathing_depth' },
  { name: 'Sweat Level', id: 'node_sweat_level' },
  { name: 'Sweat Reactivity', id: 'node_sweat_reactivity' },
  { name: 'Skin Temperature', id: 'node_skin_temperature' },
  { name: 'Muscle Tension', id: 'node_muscle_tension' }
]

const container = d3.select<HTMLDivElement, unknown>('#canvas')
const svg = container.append('svg')
// groups
const gEdges = svg.append('g').attr('class', 'edges')
const gNodes = svg.append('g').attr('class', 'nodes')
// background capture for clear
const gBg = svg.insert('g', ':first-child').attr('class', 'bg')

const playBtn = document.getElementById('playPause') as HTMLButtonElement
const scrubber = document.getElementById('scrubber') as HTMLInputElement
const conditionSelect = document.getElementById('conditionSelect') as HTMLSelectElement

let W = 800, H = 600, cx = 0, cy = 0, R0 = 180, RDelta = 140

function layout() {
  const rect = container.node()!.getBoundingClientRect()
  W = Math.max(640, rect.width)
  H = Math.max(480, rect.height)
  cx = W / 2
  cy = H / 2
  R0 = Math.min(W, H) * 0.28
  RDelta = Math.min(W, H) * 0.22
  svg.attr('width', W).attr('height', H)
}

function inverseFromZ(z: number, meta: { transform: string; mu: number; sigma: number; inverse: string }): number {
  const xp = z * meta.sigma + meta.mu
  if (meta.inverse === 'expm1') return Math.expm1(Math.max(-50, xp))
  return xp
}

function buildSizeScales(cal: GroupAPI['calibration']) {
  const scales: Record<string, (raw: number) => number> = {}
  for (const { id } of NODE_ORDER) {
    const m = cal.nodes[id]
    // larger pixel range for visibility in light mode
    const s = buildSizeScale(m.mu, m.sigma, 14, 40)
    scales[id] = s
  }
  return scales
}

function renderLegend(containerSel: d3.Selection<SVGGElement, unknown, any, any>) {
  containerSel.selectAll('*').remove()
  const x0 = 10, y0 = 10
  containerSel.append('text').text('Legend').attr('x', x0).attr('y', y0+10).attr('fill', '#6b7280').attr('font-size', 12)
  // Replica node
  const lg = containerSel.append('g').attr('transform', `translate(${x0+10}, ${y0+30})`)
  const baselineR = 18, mainR = 12, tickR = 16
  lg.append('circle').attr('r', baselineR).attr('fill', '#9ca3af').attr('fill-opacity', 0.3)
  // halo ring
  lg.append('circle').attr('r', mainR+6).attr('fill', 'none').attr('stroke', '#2563eb').attr('stroke-opacity', 0.2).attr('stroke-width', 8)
  lg.append('circle').attr('r', mainR).attr('fill', '#93c5fd')
  lg.append('circle').attr('r', tickR).attr('fill', 'none').attr('stroke', '#111827').attr('stroke-width', 1.5)
  containerSel.append('text').text('Radius = Δ vs baseline (level_z)').attr('x', x0+50).attr('y', y0+34).attr('fill', '#6b7280').attr('font-size', 12)
  containerSel.append('text').text('Size = raw now; inner = baseline mean; tick = condition mean').attr('x', x0+50).attr('y', y0+50).attr('fill', '#6b7280').attr('font-size', 12)
  containerSel.append('text').text('Halo = activity bands').attr('x', x0+50).attr('y', y0+66).attr('fill', '#6b7280').attr('font-size', 12)
  // Two mini-edges
  const eY = y0+90
  const edges = containerSel.append('g').attr('transform', `translate(${x0}, ${eY})`)
  const line = d3.line<{x:number;y:number}>()
  // in-sync
  edges.append('path').attr('d', line([{x:0,y:0},{x:60,y:0}] )||'')
    .attr('stroke', '#2563eb').attr('fill','none').attr('stroke-width', 3).attr('stroke-dasharray','6 6').attr('stroke-dashoffset','-6')
  containerSel.append('text').text('In-sync (push)').attr('x', x0+70).attr('y', eY+4).attr('fill', '#6b7280').attr('font-size', 12)
  // opposed
  edges.append('path').attr('d', line([{x:0,y:20},{x:60,y:20}] )||'')
    .attr('stroke', '#2563eb').attr('fill','none').attr('stroke-width', 3).attr('stroke-dasharray','6 6').attr('stroke-dashoffset','6')
  containerSel.append('text').text('Opposed (ping-pong)').attr('x', x0+70).attr('y', eY+24).attr('fill', '#6b7280').attr('font-size', 12)
}

async function main() {
  layout()
  window.addEventListener('resize', () => {
    layout()
    if (app) app.render()
  })

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const api = await fetchGroupJSON()

  const savedCond = parseInt(localStorage.getItem('cond') || '1', 10) || 1
  const state: AppState = {
    playing: true,
    timeIndex: 0,
    reducedMotion: prefersReduced,
    condition: savedCond
  }

  let condKey = String(state.condition)
  let series = api.conditions[condKey].series
  let tSeries = series.t
  const sizeScales = buildSizeScales(api.calibration)

  // Precompute halo bands from slope changes (WP8)
  let haloBands: Record<string, number[]> = {}
  function rebuildHaloBands() {
    haloBands = {}
    for (const { id } of NODE_ORDER) {
      const slope = series.nodes[id]?.slope ?? []
      const bands: number[] = new Array(slope.length).fill(0)
      let ema = 0
      for (let t = 1; t < slope.length; t++) {
        const dv = Math.abs((slope[t] ?? 0) - (slope[t - 1] ?? 0))
        ema = 0.3 * dv + 0.7 * ema
        // thresholds heuristic
        bands[t] = ema > 0.6 ? 3 : ema > 0.3 ? 2 : ema > 0.1 ? 1 : 0
      }
      haloBands[id] = bands
    }
  }
  rebuildHaloBands()

  scrubber.max = String(Math.max(0, tSeries.length - 1))
  scrubber.value = String(state.timeIndex)

  playBtn.addEventListener('click', () => {
    state.playing = !state.playing
    playBtn.textContent = state.playing ? 'Pause' : 'Play'
  })
  scrubber.addEventListener('input', () => {
    state.timeIndex = Math.min(Math.max(0, parseInt(scrubber.value, 10) || 0), tSeries.length - 1)
    app.render()
  })

  const app = {
    render() {
      // Draw baseline ring
      gEdges.selectAll('*').remove()
      gNodes.selectAll('*').remove()
      gBg.selectAll('*').remove()
      svg.selectAll('.r0').data([0]).join('circle')
        .attr('class', 'r0')
        .attr('cx', cx).attr('cy', cy).attr('r', R0)
        .attr('fill', 'none').attr('stroke', '#2a2f3a')
      // background rect to clear selection
      gBg.append('rect')
        .attr('x', 0).attr('y', 0).attr('width', W).attr('height', H)
        .attr('fill', 'transparent')
        .on('click', () => { state.selectedNode = undefined; renderDetails(null); app.render() })

      const angleStep = (Math.PI * 2) / NODE_ORDER.length
      const nodesData = NODE_ORDER.map((n, i) => {
        const meta = api.calibration.nodes[n.id]
        const z_now = series.nodes[n.id]?.level[state.timeIndex] ?? 0
        const r_now = R0 + zToDr(z_now, RDelta)
        const theta = i * angleStep - Math.PI / 2
        const p = polar(cx, cy, r_now, theta)
        const raw_now = inverseFromZ(z_now, meta)
        const sizePx = sizeScales[n.id](raw_now)
        // baseline disc at z=0 raw mean
        const raw_baseline = inverseFromZ(0, meta)
        const baselinePx = sizeScales[n.id](raw_baseline)
        const band = haloBands[n.id]?.[state.timeIndex] ?? 0
        // condition mean tick radius from static_raw
        const raw_cond_mean = (api.static_raw[condKey] || {})[n.id]
        const tickR = typeof raw_cond_mean === 'number' ? sizeScales[n.id](raw_cond_mean) : 0
        return { ...n, i, theta, x: p.x, y: p.y, raw_now, sizePx, baselinePx, z_now, band, tickR }
      })

      // Edges (simple: draw if |sync|>=theta and conf>=c_min)
      const edgesSeries = api.conditions[condKey].series.edges
      const edgeEntries = Object.entries(edgesSeries)
      const passed = edgeEntries.filter(([, v]) => {
        const sync = v.sync[state.timeIndex] ?? 0
        const conf = v.conf[state.timeIndex] ?? 0
        return Math.abs(sync) >= 0.15 && conf >= 0.20
      })
      console.log(`t=${state.timeIndex}, cond=${condKey}, passed=${passed.length}/${edgeEntries.length}, edgeEntries:`, edgeEntries.length)
      if (passed.length > 0) {
        console.log('Sample passed edge:', passed[0][0], 'sync=', passed[0][1].sync[state.timeIndex], 'conf=', passed[0][1].conf[state.timeIndex])
      }
      // Top-K by conf*static_conn with distance fade
      const scoreWithGeom = passed.map(d => {
        const [a, b] = d[0].split('|')
        const ia = NODE_ORDER.findIndex(n => n.name === a)
        const ib = NODE_ORDER.findIndex(n => n.name === b)
        const na = nodesData[ia]
        const nb = nodesData[ib]
        const dx = na.x - nb.x
        const dy = na.y - nb.y
        const dist = Math.sqrt(dx*dx + dy*dy)
        const stat = api.conditions[condKey].static.edges[d[0]]
        const sc = (stat?.static_conn ?? 0) * (d[1].conf[state.timeIndex] ?? 0)
        return { d, dist, sc }
      })
      const K = 12
      const visibleEdges = scoreWithGeom.sort((a,b)=>b.sc-a.sc).slice(0,K)
      console.log('visibleEdges after Top-K:', visibleEdges.length)
      if (visibleEdges.length > 0) {
        console.log('First visible edge:', visibleEdges[0].d[0], 'dist=', visibleEdges[0].dist, 'sc=', visibleEdges[0].sc)
      }
      const line = d3.line<{ x: number; y: number }>().curve(d3.curveLinear)
      
      // TEST: draw a static red line to confirm SVG rendering works
      gEdges.append('line').attr('x1', cx-50).attr('y1', cy).attr('x2', cx+50).attr('y2', cy)
        .attr('stroke', 'red').attr('stroke-width', 3)
      const edgesSel = gEdges.selectAll('path.edge')
        .data(visibleEdges, (e: any) => e.d[0])
        .join('path')
        .attr('class', 'edge')
        .attr('fill', 'none')
        .attr('stroke', '#3b82f6')
        .attr('stroke-opacity', (e: any) => {
          // combine confidence and distance fade
          const conf = e.d[1].conf[state.timeIndex] ?? 0
          const base = Math.min(1, Math.max(0.2, conf))
          const maxR = Math.min(W, H) * 0.5
          const fade = 0.3 + 0.7 * (1 - Math.min(1, e.dist / maxR))
          return Math.min(1, base * fade)
        })
        .attr('stroke-width', (e: any) => {
          // thickness = static_conn (scaled)
          const ekey = e.d[0]
          const stat = api.conditions[condKey].static.edges[ekey]
          const sc = stat ? stat.static_conn : 0.2
          return 1 + 4 * sc
        })
        .attr('d', (e: any) => {
          const [a, b] = e.d[0].split('|')
          const ia = NODE_ORDER.findIndex(n => n.name === a)
          const ib = NODE_ORDER.findIndex(n => n.name === b)
          if (ia < 0 || ib < 0) {
            console.warn('Edge node not found:', a, b, 'ia=', ia, 'ib=', ib)
            return ''
          }
          const na = nodesData[ia]
          const nb = nodesData[ib]
          const pathD = line([{ x: na.x, y: na.y }, { x: nb.x, y: nb.y }]) || ''
          if (!pathD && visibleEdges.indexOf(e) === 0) {
            console.log('First edge path:', a, '->', b, 'na:', na.x, na.y, 'nb:', nb.x, nb.y, 'd:', pathD)
          }
          return pathD
        })

      // simple flow indication via dash offset (push for sync>0, ping-pong for sync<0)
      edgesSel
        .attr('stroke-dasharray', '6 6')
        .attr('stroke-dashoffset', (e: any) => {
          const sync = e.d[1].sync[state.timeIndex] ?? 0
          const dir = sync >= 0 ? 1 : (state.timeIndex % 2 === 0 ? 1 : -1)
          return String((-state.timeIndex * 2) * dir)
        })

      // Nodes
      const nodeG = gNodes.selectAll('g.node').data(nodesData, d => (d as any).id)
        .join(enter => {
          const g = enter.append('g').attr('class', 'node')
          g.append('circle').attr('class', 'baseline').attr('fill', '#4b5563').attr('fill-opacity', 0.3)
          g.append('circle').attr('class', 'main').attr('fill', '#93c5fd')
          g.append('circle').attr('class', 'tick').attr('fill', 'none').attr('stroke', '#111827').attr('stroke-width', 1.5)
          g.append('text').attr('class', 'label').attr('text-anchor', 'middle').attr('dy', '0.32em')
          // a11y
          g.attr('tabindex', 0)
          g.on('keydown', (ev: KeyboardEvent, d: any) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              state.selectedNode = state.selectedNode === d.id ? undefined : d.id
              renderDetails(d)
              app.render()
            }
          })
          return g
        }) as d3.Selection<SVGGElement, any, any, any>

      nodeG.attr('transform', d => `translate(${d.x},${d.y})`)
      nodeG.select('circle.baseline').attr('r', d => d.baselinePx)
      nodeG.select('circle.main').attr('r', d => d.sizePx)
        .attr('fill-opacity', d => [0.3, 0.6, 0.8, 1.0][d.band])
      nodeG.select('circle.tick')
        .attr('r', d => (state.selectedNode === d.id ? d.tickR : 0))
      nodeG.select('text.label')
        .text(d => `${d.raw_now.toFixed(api.calibration.nodes[d.id].precision)}`)
        .style('display', d => (d.sizePx < 10 ? 'none' : 'block'))

      // selection behavior
      nodeG.on('click', (_, d) => {
        state.selectedNode = state.selectedNode === d.id ? undefined : d.id
        renderDetails(d)
      })

      // Dim non-incident edges when a node is selected
      if (state.selectedNode) {
        const selName = NODE_ORDER.find(n => n.id === state.selectedNode)!.name
        edgesSel.attr('stroke-opacity', (e: any) => {
          const [a, b] = e.d[0].split('|')
          const base = Math.min(1, (e.d[1].conf[state.timeIndex] ?? 0))
          return (a === selName || b === selName) ? base : base * 0.2
        })
      }

      renderLegend(svg.append('g').attr('transform', `translate(12, ${H - 110})`))
    }
  }

  function renderDetails(d: any) {
    const el = document.getElementById('details')!
    if (!d) { el.textContent = 'Select a node'; return }
    const meta = api.calibration.nodes[d.id]
    const rawNow = d.raw_now as number
    const rawBase = inverseFromZ(0, meta)
    const rawCond = (api.static_raw[String(state.condition)] || {})[d.id]
    const zNow = d.z_now as number
    const zPrev = (api.conditions[String(state.condition)].series.nodes[d.id]?.level[(state.timeIndex-1+ (api.conditions[String(state.condition)].series.t.length)) % (api.conditions[String(state.condition)].series.t.length)] ?? zNow) as number
    const dz = zNow - zPrev
    const deltaRaw = rawNow - rawBase
    const condStr = typeof rawCond === 'number' ? `${rawCond.toFixed(meta.precision)} ${meta.units}` : 'N/A'
    el.innerHTML = `
      <div><strong>${d.name}</strong></div>
      <div>Now: ${rawNow.toFixed(meta.precision)} ${meta.units}</div>
      <div>Δ vs baseline: ${deltaRaw.toFixed(meta.precision)} ${meta.units}</div>
      <div>z: ${zNow.toFixed(2)}  Δz: ${dz.toFixed(2)}</div>
      <div>Condition mean: ${condStr}</div>
      <div>Baseline mean: ${rawBase.toFixed(meta.precision)} ${meta.units}</div>
    `
  }

  // Ticker
  function tick() {
    if (state.playing) {
      state.timeIndex = (state.timeIndex + 1) % tSeries.length
      scrubber.value = String(state.timeIndex)
      app.render()
    }
    const delay = state.reducedMotion ? 800 : 450
    setTimeout(tick, delay)
  }

  // condition switching
  conditionSelect.value = condKey
  conditionSelect.addEventListener('change', () => {
    state.condition = parseInt(conditionSelect.value, 10) as any
    condKey = String(state.condition)
    series = api.conditions[condKey].series
    tSeries = series.t
    rebuildHaloBands()
    scrubber.max = String(Math.max(0, tSeries.length - 1))
    state.timeIndex = Math.min(state.timeIndex, tSeries.length - 1)
    scrubber.value = String(state.timeIndex)
    localStorage.setItem('cond', condKey)
    app.render()
  })

  // Esc clears selection; 1-4 switches condition
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { state.selectedNode = undefined; renderDetails(null); app.render() }
    if (['1','2','3','4'].includes(ev.key)) {
      conditionSelect.value = ev.key
      conditionSelect.dispatchEvent(new Event('change'))
    }
  })

  app.render()
  tick()
}

main().catch(err => console.error(err))
