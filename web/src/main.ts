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
const gCondMean = svg.append('g').attr('class', 'cond-mean-markers')
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
    const s = buildSizeScale(m.mu, m.sigma, 24, 68)
    scales[id] = s
  }
  return scales
}

function buildTopArcPath(r: number): string {
  const startAngle = Math.PI
  const endAngle = 0
  const start = polar(0, 0, r, startAngle)
  const end = polar(0, 0, r, endAngle)
  const largeArcFlag = 0
  const sweepFlag = 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`
}

function renderLegend(containerSel: d3.Selection<SVGGElement, unknown, any, any>, animationTime: number) {
  containerSel.selectAll('*').remove()
  const x0 = 10, y0 = 10
  containerSel.append('rect')
    .attr('x', x0 - 8)
    .attr('y', y0 - 6)
    .attr('width', 360)
    .attr('height', 214)
    .attr('rx', 16)
    .attr('fill', '#f2f7f4')
    .attr('stroke', '#c9e0d5')
    .attr('stroke-width', 1.2)

  containerSel.append('text')
    .text('Legend')
    .attr('x', x0 + 4)
    .attr('y', y0 + 16)
    .attr('fill', '#163a31')
    .attr('font-weight', 600)
    .attr('font-size', 14)

  const section = containerSel.append('g').attr('transform', `translate(${x0 + 8}, ${y0 + 40})`)

  const lg = section.append('g')
  const baselineR = 31, mainR = 20, tickR = 27
  lg.attr('transform', 'translate(34, 44)')
  lg.append('circle').attr('r', baselineR).attr('fill', '#bcd8c8').attr('fill-opacity', 0.45)
  lg.append('circle').attr('r', mainR + 6).attr('fill', 'none').attr('stroke', '#3c8c78').attr('stroke-opacity', 0.28).attr('stroke-width', 9)
  lg.append('circle').attr('r', mainR).attr('fill', '#56b199')
  lg.append('circle').attr('r', tickR).attr('fill', 'none').attr('stroke', '#134e4a').attr('stroke-width', 1.5)

  const markerSize = 7
  const legendTriangle = [
    [0 - markerSize, -baselineR - markerSize],
    [0 + markerSize, -baselineR - markerSize],
    [0, -baselineR + markerSize]
  ]
  lg.append('path')
    .attr('d', `M ${legendTriangle[0][0]} ${legendTriangle[0][1]} L ${legendTriangle[1][0]} ${legendTriangle[1][1]} L ${legendTriangle[2][0]} ${legendTriangle[2][1]} Z`)
    .attr('fill', '#c52b36')
    .attr('stroke', '#7f1d1d')
    .attr('stroke-width', 1.2)
    .attr('fill-opacity', 0.9)

  const sampleArcId = 'legend-name-arc'
  lg.append('path')
    .attr('id', sampleArcId)
    .attr('fill', 'none')
    .attr('stroke', 'none')
    .attr('d', buildTopArcPath(mainR + 22))

  lg.append('text')
    .attr('fill', '#184c3d')
    .attr('font-size', 11)
    .append('textPath')
    .attr('href', `#${sampleArcId}`)
    .attr('startOffset', '50%')
    .attr('text-anchor', 'middle')
    .text('Cardiac Rhythm (bpm)')

  lg.append('text')
    .attr('class', 'legend-node-value')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', '#0b2e27')
    .attr('font-size', 11)
    .text('68.2')

  const details = section.append('g').attr('transform', 'translate(112, 4)')
  const detailLines = [
    'Radius = Δ vs baseline (level_z)',
    'Size = raw now; baseline ring shown',
    'Red triangle = condition mean (static)',
    'Halo = activity bands (slope ∆)'
  ]
  detailLines.forEach((line, idx) => {
    details.append('text')
      .text(line)
      .attr('x', 0)
      .attr('y', idx * 16)
      .attr('fill', '#1f463a')
      .attr('font-size', 12)
  })

  const edges = section.append('g').attr('transform', 'translate(0, 116)')
  const line = d3.line<{ x: number; y: number }>().x(d => d.x).y(d => d.y)

  edges.append('path')
    .attr('d', line([{ x: 0, y: 0 }, { x: 90, y: 0 }]) || '')
    .attr('stroke', '#35b79a')
    .attr('fill', 'none')
    .attr('stroke-width', 4)
    .attr('stroke-dasharray', '24 10')
    .attr('stroke-dashoffset', (-animationTime * 28) % 34)

  edges.append('path')
    .attr('d', line([{ x: 0, y: 26 }, { x: 90, y: 26 }]) || '')
    .attr('stroke', '#f07167')
    .attr('fill', 'none')
    .attr('stroke-width', 4)
    .attr('stroke-dasharray', '6 6 2 6')
    .attr('stroke-dashoffset', Math.sin(animationTime * 3.5) * 14)

  const edgeLabels = section.append('g').attr('transform', 'translate(124, 122)')
  edgeLabels.append('text')
    .text('Push (in-sync, driving)')
    .attr('x', 0)
    .attr('y', 0)
    .attr('fill', '#1f463a')
    .attr('font-size', 12)
  edgeLabels.append('text')
    .text('Pull (opposed, ping-pong)')
    .attr('x', 0)
    .attr('y', 26)
    .attr('fill', '#1f463a')
    .attr('font-size', 12)
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

  const startTime = performance.now()
  let animationTime = 0

  const legendRoot = svg.append('g').attr('class', 'legend')

  const app = {
    render() {
      layout()
      animationTime = (performance.now() - startTime) / 1000

      gEdges.selectAll('*').remove()
      gCondMean.selectAll('*').remove()
      gNodes.selectAll('*').remove()
      gBg.selectAll('*').remove()

      svg.selectAll('.r0').data([0]).join('circle')
        .attr('class', 'r0')
        .attr('cx', cx).attr('cy', cy).attr('r', R0)
        .attr('fill', 'none').attr('stroke', '#2a2f3a')

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
        const raw_baseline = inverseFromZ(0, meta)
        const baselinePx = sizeScales[n.id](raw_baseline)
        const band = haloBands[n.id]?.[state.timeIndex] ?? 0
        const raw_cond_mean = (api.static_raw[condKey] || {})[n.id]
        const tickR = typeof raw_cond_mean === 'number' ? sizeScales[n.id](raw_cond_mean) : 0
        const condMeanPx = (state.condition !== 1 && typeof raw_cond_mean === 'number') 
          ? sizeScales[n.id](raw_cond_mean) 
          : 0
        return {
          ...n,
          i,
          theta,
          x: p.x,
          y: p.y,
          raw_now,
          sizePx,
          baselinePx,
          z_now,
          band,
          tickR,
          condMeanPx,
          units: meta.units,
          precision: meta.precision
        }
      })

      const edgesSeries = api.conditions[condKey].series.edges
      const edgeEntries = Object.entries(edgesSeries)
      const passed = edgeEntries.filter(([, v]) => {
        const sync = v.sync[state.timeIndex] ?? 0
        const conf = v.conf[state.timeIndex] ?? 0
        return Math.abs(sync) >= 0.15 && conf >= 0.20
      })

      const scoreWithGeom = passed.map(d => {
        const [a, b] = d[0].split('|')
        const ia = NODE_ORDER.findIndex(n => n.name === a)
        const ib = NODE_ORDER.findIndex(n => n.name === b)
        if (ia < 0 || ib < 0) return null
        const na = nodesData[ia]
        const nb = nodesData[ib]
        const dx = na.x - nb.x
        const dy = na.y - nb.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const stat = api.conditions[condKey].static.edges[d[0]]
        const sc = (stat?.static_conn ?? 0) * (d[1].conf[state.timeIndex] ?? 0)
        return { d, dist, sc }
      }).filter((x): x is NonNullable<typeof x> => x !== null)

      const K = 12
      const visibleEdges = scoreWithGeom.sort((a, b) => b.sc - a.sc).slice(0, K)

      const line = d3.line<{ x: number; y: number }>()
        .x(d => d.x)
        .y(d => d.y)
        .curve(d3.curveLinear)

      const edgesSel = gEdges.selectAll<SVGPathElement, typeof visibleEdges[number]>('path.edge')
        .data(visibleEdges, e => e.d[0])
        .join('path')
        .attr('class', 'edge')
        .attr('fill', 'none')
        .attr('stroke', e => {
          const sync = e.d[1].sync[state.timeIndex] ?? 0
          return sync >= 0 ? '#35b79a' : '#f07167'
        })
        .attr('stroke-opacity', e => {
          const conf = e.d[1].conf[state.timeIndex] ?? 0
          const base = Math.min(1, Math.max(0.2, conf))
          const maxR = Math.min(W, H) * 0.5
          const fade = 0.3 + 0.7 * (1 - Math.min(1, e.dist / maxR))
          return Math.min(1, base * fade)
        })
        .attr('stroke-width', e => {
          const ekey = e.d[0]
          const stat = api.conditions[condKey].static.edges[ekey]
          const sc = stat ? stat.static_conn : 0.2
          return 1.2 + 4.5 * sc
        })
        .attr('d', e => {
          const [a, b] = e.d[0].split('|')
          const ia = NODE_ORDER.findIndex(n => n.name === a)
          const ib = NODE_ORDER.findIndex(n => n.name === b)
          if (ia < 0 || ib < 0) return ''
          const na = nodesData[ia]
          const nb = nodesData[ib]
          return line([{ x: na.x, y: na.y }, { x: nb.x, y: nb.y }]) || ''
        })
        .attr('stroke-dasharray', e => {
          const sync = e.d[1].sync[state.timeIndex] ?? 0
          return sync >= 0 ? '24 10' : '6 6 2 6'
        })
        .attr('stroke-dashoffset', e => {
          const sync = e.d[1].sync[state.timeIndex] ?? 0
          const offset = sync >= 0
            ? (-animationTime * 28) + Math.sin(animationTime * 3) * 2
            : Math.sin(animationTime * 3.5) * 14
          return String(offset)
        })

      // Render static condition mean markers (only for non-baseline conditions)
      if (state.condition !== 1) {
        const condMeanMarkers = nodesData
          .filter(d => d.condMeanPx > 0)
          .map(d => {
            const meta = api.calibration.nodes[d.id]
            const raw_cond_mean = (api.static_raw[condKey] || {})[d.id]
            if (typeof raw_cond_mean !== 'number') return null

            // Calculate z-score for condition mean
            const z_cond_mean = (raw_cond_mean - meta.mu) / meta.sigma
            const r_cond_mean = R0 + zToDr(z_cond_mean, RDelta)
            const p = polar(cx, cy, r_cond_mean, d.theta)

            return { ...d, staticX: p.x, staticY: p.y }
          })
          .filter((d): d is NonNullable<typeof d> => d !== null)

        const markerSize = 7
        gCondMean.selectAll<SVGPathElement, typeof condMeanMarkers[0]>('path.cond-mean-marker')
          .data(condMeanMarkers, d => d.id)
          .join(enter => enter.append('path').attr('class', 'cond-mean-marker'))
          .attr('d', d => {
            const { staticX: x, staticY: y } = d
            const topLeft = `${x - markerSize} ${y - markerSize}`
            const topRight = `${x + markerSize} ${y - markerSize}`
            const bottom = `${x} ${y + markerSize}`
            return `M ${topLeft} L ${topRight} L ${bottom} Z`
          })
          .attr('fill', '#c52b36')
          .attr('stroke', '#7f1d1d')
          .attr('stroke-width', 1.2)
          .attr('fill-opacity', 0.9)
      }

      const nodeG = gNodes.selectAll<SVGGElement, typeof nodesData[0]>('g.node')
        .data(nodesData, d => d.id)
        .join(enter => {
          const g = enter.append('g')
            .attr('class', 'node')
            .attr('tabindex', 0)
            .on('keydown', (ev: KeyboardEvent, d) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                state.selectedNode = state.selectedNode === d.id ? undefined : d.id
                renderDetails(d)
                app.render()
              }
            })
            .on('click', (_, d) => {
              state.selectedNode = state.selectedNode === d.id ? undefined : d.id
              renderDetails(d)
            })

          g.append('circle').attr('class', 'baseline').attr('fill', '#4b5563').attr('fill-opacity', 0.28)
          g.append('circle').attr('class', 'main').attr('fill', '#93c5fd')
          g.append('circle').attr('class', 'tick').attr('fill', 'none').attr('stroke', '#111827').attr('stroke-width', 1.5)
          g.append('path').attr('class', 'name-arc').attr('fill', 'none').attr('stroke', 'none')

          const valueText = g.append('text')
            .attr('class', 'value')
            .attr('text-anchor', 'middle')
            .attr('fill', '#0b2e27')
            .attr('font-weight', 600)
            .attr('dy', '0.4em')
          valueText.append('tspan')

          const nameText = g.append('text')
            .attr('class', 'name')
            .attr('fill', '#184c3d')
            .attr('font-size', 12)
          nameText.append('textPath')
            .attr('startOffset', '50%')
            .attr('text-anchor', 'middle')

          return g
        })

      nodeG.attr('transform', d => `translate(${d.x},${d.y})`)

      nodeG.select('circle.baseline').attr('r', d => d.baselinePx)

      nodeG.select('circle.main')
        .attr('r', d => d.sizePx)
        .attr('fill-opacity', d => [0.3, 0.6, 0.8, 1.0][d.band])

      nodeG.select('circle.tick')
        .attr('r', d => (state.selectedNode === d.id ? d.tickR : 0))

      nodeG.select('path.name-arc')
        .attr('id', d => `name-arc-${d.id}`)
        .attr('d', d => buildTopArcPath(d.sizePx + 26))

      nodeG.select('text.value')
        .style('display', d => (d.sizePx < 18 ? 'none' : 'block'))
        .text(d => d.raw_now.toFixed(d.precision))

      nodeG.select('text.name textPath')
        .attr('href', d => `#name-arc-${d.id}`)
        .text(d => {
          const unitLabel = d.units?.trim() ? d.units : 'a.u.'
          return `${d.name} (${unitLabel})`
        })

      if (state.selectedNode) {
        const selName = NODE_ORDER.find(n => n.id === state.selectedNode)!.name
        edgesSel.attr('stroke-opacity', e => {
          const [a, b] = e.d[0].split('|')
          const base = Math.min(1, (e.d[1].conf[state.timeIndex] ?? 0))
          return (a === selName || b === selName) ? base : base * 0.2
        })
      }

      legendRoot.attr('transform', `translate(12, ${H - 220})`)
      renderLegend(legendRoot, animationTime)
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
