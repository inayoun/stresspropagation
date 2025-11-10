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

// Landing page elements
const landingOverlay = document.getElementById('landingOverlay') as HTMLDivElement
const landingCard = document.getElementById('landingCard') as HTMLDivElement
const landingTitle = document.getElementById('landingTitle') as HTMLHeadingElement
const landingText = document.getElementById('landingText') as HTMLParagraphElement
const landingStage = document.getElementById('landingStage') as HTMLSpanElement
const landingPrev = document.getElementById('landingPrev') as HTMLButtonElement
const landingNext = document.getElementById('landingNext') as HTMLButtonElement
const landingClose = document.getElementById('landingClose') as HTMLButtonElement

const LANDING_STAGES = [
  {
    title: 'Nervous System Dashboard',
    text: 'This visualization shows how different physiological systems (heart rate, temperature, and muscle tension) change in response to different emotional states like stress, meditation, and amusement.'
  },
  {
    title: 'Baseline ring',
    text: 'The black circle represents the baseline average for each of the 8 physiological systems. All changes are read relative to this baseline circle: farther out = higher value, inward = lower.'
  },
  {
    title: 'Hue = speed of change',
    text: 'The hue represents the slope, or how rapidly the activity is changing. A stronger hue means a more rapid change. The wave\'s distance is the z-value (how far from the mean), but click on the name to view the actual values.'
  },
  {
    title: 'System connections',
    text: 'The dotted lines show whether the systems are moving in sync or not.'
  },
  {
    title: 'Condition mean',
    text: 'The darker curve shows the average for this condition. Baseline circle stays for reference.'
  },
  {
    title: 'Try it out',
    text: 'Use Pause/Play and the timeline scrubber. Click on a system to see more details.'
  }
]

let landingStageIndex = 0
let reopenTutorial: (() => void) | null = null

let W = 800, H = 600, cx = 0, cy = 0, R0 = 180, RDelta = 140

const WHAT_IT_IS: Record<string, string> = {
  'Cardiac Rhythm (HRV)': 'Beat-to-beat variability from chest ECG R-R intervals. Drops with acute stress and rises with relaxed, slow breathing.',
  'Cardiac Rhythm': 'Beat-to-beat variability from chest ECG R-R intervals. Drops with acute stress and rises with relaxed, slow breathing.',
  'Heart Rate': 'Beats per minute from chest ECG; wrist BVP as fallback. Rises with stress and falls with rest.',
  'Breathing Rate': 'Breaths per minute from the respiration belt. Speeds up under load or speech and slows with calm.',
  'Breathing Depth': 'Average respiratory amplitude/envelope. Becomes shallower with stress and deeper with relaxation.',
  'Sweat Level (tonic EDA)': 'Baseline skin conductance. Elevates with sympathetic arousal and lowers at rest.',
  'Sweat Level': 'Baseline skin conductance. Elevates with sympathetic arousal and lowers at rest.',
  'Sweat Reactivity (phasic EDA)': 'Skin conductance responses per minute. Increases with startle or effort and decreases in calm.',
  'Sweat Reactivity': 'Skin conductance responses per minute. Increases with startle or effort and decreases in calm.',
  'Skin Temperature': 'Surface skin temperature. Often dips with stress due to vasoconstriction and warms at rest.',
  'Muscle Tension (EMG)': 'Rectified, smoothed shoulder/neck muscle activity. Climbs with tension or effort and eases with relaxation.',
  'Muscle Tension': 'Rectified, smoothed shoulder/neck muscle activity. Climbs with tension or effort and eases with relaxation.'
}

function normalizeNameForDesc(name: string): string {
  const stripped = name.replace(/\s*\([^)]*\)\s*/g, '').trim()
  return WHAT_IT_IS[name] ? name : (WHAT_IT_IS[stripped] ? stripped : name)
}

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

function renderLegend(containerSel: d3.Selection<SVGGElement, unknown, any, any>, animationTime: number) {
  containerSel.selectAll('*').remove()
  const x0 = 10, y0 = 10

  // Simple SVG text wrap helper
  function wrapText(textSel: d3.Selection<SVGTextElement, unknown, any, any>, width: number) {
    textSel.each(function() {
      const text = d3.select(this)
      const words = (text.text() || '').split(/\s+/).filter(Boolean)
      let line: string[] = []
      let lineNumber = 0
      const lineHeight = 14 // px
      const x = Number(text.attr('x') || 0)
      const y = Number(text.attr('y') || 0)
      const dy = 0
      let tspan = text.text(null).append('tspan').attr('x', x).attr('y', y).attr('dy', `${dy}px`)
      for (const word of words) {
        line.push(word)
        tspan.text(line.join(' '))
        // Use getComputedTextLength for accurate width
        if ((tspan.node()?.getComputedTextLength() || 0) > width) {
          line.pop()
          tspan.text(line.join(' '))
          line = [word]
          tspan = text.append('tspan')
            .attr('x', x)
            .attr('y', y)
            .attr('dy', `${++lineNumber * lineHeight}px`)
            .text(word)
        }
      }
    })
  }
  containerSel.append('rect')
    .attr('x', x0 - 8)
    .attr('y', y0 - 6)
    .attr('width', 300)
    .attr('height', 300)
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

  // Info icon to reopen tutorial
  const infoGroup = containerSel.append('g')
    .attr('transform', `translate(${x0 + 280}, ${y0 + 4})`)
    .style('cursor', 'pointer')
  
  infoGroup.append('circle')
    .attr('r', 10)
    .attr('fill', '#c9e0d5')
    .attr('stroke', '#163a31')
    .attr('stroke-width', 1.5)
  
  infoGroup.append('text')
    .text('?')
    .attr('x', 0)
    .attr('y', 5)
    .attr('text-anchor', 'middle')
    .attr('fill', '#163a31')
    .attr('font-weight', 700)
    .attr('font-size', 14)
  
  infoGroup.on('click', () => {
    if (reopenTutorial) reopenTutorial()
  })

  const section = containerSel.append('g').attr('transform', `translate(${x0 + 8}, ${y0 + 40})`)

  const lg = section.append('g')
  const sectorAngleLegend = Math.PI / 4
  const baselineR = 31, currentR = 20
  lg.attr('transform', 'translate(34, 44)')
  
  // Baseline circle
  lg.append('circle').attr('r', baselineR).attr('fill', 'none').attr('stroke', '#c9e0d5').attr('stroke-width', 1)
  
  // Sector boundaries
  lg.append('line')
    .attr('x1', 0).attr('y1', 0)
    .attr('x2', baselineR * Math.cos(-sectorAngleLegend/2))
    .attr('y2', baselineR * Math.sin(-sectorAngleLegend/2))
    .attr('stroke', '#c9e0d5').attr('stroke-width', 1).attr('stroke-opacity', 0.5)
  lg.append('line')
    .attr('x1', 0).attr('y1', 0)
    .attr('x2', baselineR * Math.cos(sectorAngleLegend/2))
    .attr('y2', baselineR * Math.sin(sectorAngleLegend/2))
    .attr('stroke', '#c9e0d5').attr('stroke-width', 1).attr('stroke-opacity', 0.5)
  
  // Condition mean waveform example (line only)
  const condMeanR = 24
  const condMeanWavePoints: {x: number, y: number}[] = []
  const condBaselinePoints: {x: number, y: number}[] = []
  const numPts = 15
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts
    const angle = -sectorAngleLegend/2 + t * sectorAngleLegend
    const sineFactor = Math.sin(t * Math.PI)
    const r = baselineR + (condMeanR - baselineR) * sineFactor
    condMeanWavePoints.push({x: r * Math.cos(angle), y: r * Math.sin(angle)})
  }
  for (let i = numPts; i >= 0; i--) {
    const t = i / numPts
    const angle = -sectorAngleLegend/2 + t * sectorAngleLegend
    condBaselinePoints.push({x: baselineR * Math.cos(angle), y: baselineR * Math.sin(angle)})
  }
  const condMeanPath = condMeanWavePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  lg.append('path')
    .attr('d', condMeanPath)
    .attr('fill', 'none')
    .attr('stroke', '#d4a574')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.9)
  
  // Current value waveform example
  const wavePoints: {x: number, y: number}[] = []
  const baselinePoints: {x: number, y: number}[] = []
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts
    const angle = -sectorAngleLegend/2 + t * sectorAngleLegend
    const sineFactor = Math.sin(t * Math.PI)
    const r = baselineR + (currentR - baselineR) * sineFactor
    wavePoints.push({x: r * Math.cos(angle), y: r * Math.sin(angle)})
  }
  for (let i = numPts; i >= 0; i--) {
    const t = i / numPts
    const angle = -sectorAngleLegend/2 + t * sectorAngleLegend
    baselinePoints.push({x: baselineR * Math.cos(angle), y: baselineR * Math.sin(angle)})
  }
  const wavePath = wavePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const basePath = baselinePoints.map(p => `L ${p.x} ${p.y}`).join(' ')
  lg.append('path')
    .attr('d', `${wavePath} ${basePath} Z`)
    .attr('fill', '#56b199')
    .attr('fill-opacity', 0.6)
    .attr('stroke', '#35b79a')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.8)



  const details = section.append('g').attr('transform', 'translate(112, 4)')
  
  const detailLines = [
    'Systems\' waves move in relation to mean baseline center axis.'
  ]
  detailLines.forEach((line, idx) => {
    const t = details.append('text')
      .text(line)
      .attr('x', 0)
      .attr('y', idx * 16)
      .attr('fill', '#1f463a')
      .attr('font-size', 12)
    wrapText(t as any, 168)
  })

  // Condition mean line positioned directly above edge lines
  const condLegend = section.append('g').attr('transform', 'translate(0, 96)')
  condLegend.append('path')
    .attr('d', 'M 0 0 L 90 0')
    .attr('stroke', '#d4a574')
    .attr('fill', 'none')
    .attr('stroke-width', 2)
  const condLabel = section.append('g').attr('transform', 'translate(112, 100)')
  const condText = condLabel.append('text')
    .text('Condition mean')
    .attr('x', 0)
    .attr('y', 4)
    .attr('fill', '#1f463a')
    .attr('font-size', 12)
  wrapText(condText as any, 168)

  const edges = section.append('g').attr('transform', 'translate(0, 122)')
  const line = d3.line<{ x: number; y: number }>().x(d => d.x).y(d => d.y)

  edges.append('path')
    .attr('d', line([{ x: 0, y: 0 }, { x: 90, y: 0 }]) || '')
    .attr('stroke', '#4f46e5')
    .attr('fill', 'none')
    .attr('stroke-width', 4)
    .attr('stroke-dasharray', '24 10')
    .attr('stroke-dashoffset', (-animationTime * 28) % 34)

  edges.append('path')
    .attr('d', line([{ x: 0, y: 40 }, { x: 90, y: 40 }]) || '')
    .attr('stroke', '#ec4899')
    .attr('fill', 'none')
    .attr('stroke-width', 4)
    .attr('stroke-dasharray', '6 6 2 6')
    .attr('stroke-dashoffset', Math.sin(animationTime * 3.5) * 14)

  const edgeLabels = section.append('g').attr('transform', 'translate(112, 124)')
  const syncedText = edgeLabels.append('text')
    .text('Synced relationship: Both systems increasing or decreasing together')
    .attr('x', 0)
    .attr('y', 0)
    .attr('fill', '#1f463a')
    .attr('font-size', 12)
  wrapText(syncedText as any, 168)
  const inverseText = edgeLabels.append('text')
    .text('Inverse relationship: Moving in opposite directions (one up, one down)')
    .attr('x', 0)
    .attr('y', 48)
    .attr('fill', '#1f463a')
    .attr('font-size', 12)
  wrapText(inverseText as any, 168)
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

  // Precompute halo bands from slope changes
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

  const playBtnText = playBtn.querySelector('.btn-text') as HTMLElement
  playBtn.addEventListener('click', () => {
    state.playing = !state.playing
    playBtnText.textContent = state.playing ? '⏸ Pause' : '▶ Play'
  })
  scrubber.addEventListener('input', () => {
    state.timeIndex = Math.min(Math.max(0, parseInt(scrubber.value, 10) || 0), tSeries.length - 1)
    app.render()
  })

  // Prevent sidebar clicks from interfering with playback
  const detailsPanel = document.getElementById('details')!
  detailsPanel.addEventListener('click', (e) => {
    e.stopPropagation()
  })
  detailsPanel.addEventListener('mousedown', (e) => {
    e.stopPropagation()
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
        .on('click', () => { state.selectedNode = undefined; renderDetails(''); app.render() })

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

      // Calculate aggregated edge metrics across entire timeline for this condition
      const edgesSeries = api.conditions[condKey].series.edges
      const edgeEntries = Object.entries(edgesSeries)
      
      const aggregatedEdges = edgeEntries.map(([key, series]) => {
        const [a, b] = key.split('|')
        const ia = NODE_ORDER.findIndex(n => n.name === a)
        const ib = NODE_ORDER.findIndex(n => n.name === b)
        if (ia < 0 || ib < 0) return null
        
        // Calculate average sync and conf across entire timeline
        const syncValues = series.sync.filter((v): v is number => v != null)
        const confValues = series.conf.filter((v): v is number => v != null)
        
        if (syncValues.length === 0 || confValues.length === 0) return null
        
        const avg_sync = syncValues.reduce((sum, v) => sum + v, 0) / syncValues.length
        const avg_conf = confValues.reduce((sum, v) => sum + v, 0) / confValues.length
        
        const stat = api.conditions[condKey].static.edges[key]
        const static_conn = stat?.static_conn ?? 0.2
        
        return {
          key,
          nodeA: a,
          nodeB: b,
          indexA: ia,
          indexB: ib,
          avg_sync,
          avg_conf,
          static_conn,
          combinedScore: avg_conf * static_conn
        }
      }).filter((x): x is NonNullable<typeof x> => x !== null)
      
      // Filter by thresholds and select top K
      const passed = aggregatedEdges.filter(e => 
        Math.abs(e.avg_sync) >= 0.15 && e.avg_conf >= 0.20
      )
      
      const K = 12
      const visibleEdges = passed.sort((a, b) => b.static_conn - a.static_conn).slice(0, K)
      const staticOpacity = (conn: number) => Math.min(0.9, Math.max(0.2, conn * 1.4))
      
      // Debug: Log edge metrics for breathing rate/depth
      const breathingEdge = aggregatedEdges.find(e => 
        (e.nodeA === 'Breathing Rate' && e.nodeB === 'Breathing Depth') ||
        (e.nodeA === 'Breathing Depth' && e.nodeB === 'Breathing Rate')
      )
      if (breathingEdge) {
        console.log('Breathing Rate ↔ Depth edge:', {
          avg_conf: breathingEdge.avg_conf.toFixed(3),
          static_conn: breathingEdge.static_conn.toFixed(3),
          combinedScore: breathingEdge.combinedScore.toFixed(3),
          avg_sync: breathingEdge.avg_sync.toFixed(3),
          passed_threshold: Math.abs(breathingEdge.avg_sync) >= 0.15 && breathingEdge.avg_conf >= 0.20
        })
      }
      
      console.log(`Condition ${condKey}: ${aggregatedEdges.length} total edges, ${passed.length} passed thresholds, ${visibleEdges.length} visible`)
      console.log('Top 5 edges by static_conn (current opacity basis):')
      visibleEdges.slice(0, 5).forEach((e, i) => {
        console.log(`  ${i+1}. ${e.nodeA} ↔ ${e.nodeB}:`, {
          avg_conf: e.avg_conf.toFixed(3),
          static_conn: e.static_conn.toFixed(3),
          combinedScore: e.combinedScore.toFixed(3),
          avg_sync: e.avg_sync.toFixed(3)
        })
      })
      
      console.log('Top 5 edges by combined score (avg_conf × static_conn):')
      const byCombined = [...passed].sort((a, b) => b.combinedScore - a.combinedScore).slice(0, 5)
      byCombined.forEach((e, i) => {
        console.log(`  ${i+1}. ${e.nodeA} ↔ ${e.nodeB}:`, {
          avg_conf: e.avg_conf.toFixed(3),
          static_conn: e.static_conn.toFixed(3),
          combinedScore: e.combinedScore.toFixed(3),
          avg_sync: e.avg_sync.toFixed(3)
        })
      })

      const bundleLine = d3.line<{ x: number; y: number }>()
        .x(d => d.x)
        .y(d => d.y)
        .curve(d3.curveBundle.beta(0.85))

      const computeBundlePoints = (thetaA: number, thetaB: number) => {
        let a = thetaA
        let b = thetaB
        let diff = b - a
        if (Math.abs(diff) > Math.PI) {
          if (diff > 0) {
            a += Math.PI * 2
          } else {
            b += Math.PI * 2
          }
          diff = b - a
        }

        const radii = [R0, R0 * 0.72, R0 * 0.3, R0 * 0.72, R0]
        const ts = [0, 0.35, 0.5, 0.65, 1]

        return ts.map((t, idx) => {
          const angle = a + diff * t
          const radius = radii[idx]
          const point = polar(cx, cy, radius, angle)
          return { x: point.x, y: point.y }
        })
      }

      const edgesSel = gEdges.selectAll<SVGPathElement, typeof visibleEdges[number]>('path.edge')
        .data(visibleEdges, e => e.key)
        .join('path')
        .attr('class', 'edge')
        .attr('fill', 'none')
        .attr('stroke', e => e.avg_sync >= 0 ? '#4f46e5' : '#ec4899')
        .attr('stroke-opacity', e => staticOpacity(e.static_conn))
        .attr('stroke-width', 3)
        .attr('d', e => {
          // Connect at baseline radius (R0) at each node's angular position
          const thetaA = nodesData[e.indexA].theta
          const thetaB = nodesData[e.indexB].theta
          const points = computeBundlePoints(thetaA, thetaB)
          return bundleLine(points) || ''
        })
        .attr('stroke-dasharray', e => e.avg_sync >= 0 ? '24 10' : '6 6 2 6')
        .attr('stroke-dashoffset', e => {
          // Only animate if connected to selected node (by index to avoid name mismatches)
          if (!state.selectedNode) return '0'
          const selIdx = nodesData.find(nd => nd.id === state.selectedNode)?.i
          if (selIdx == null) return '0'
          if (e.indexA !== selIdx && e.indexB !== selIdx) return '0'

          const offset = e.avg_sync >= 0
            ? (-animationTime * 28) + Math.sin(animationTime * 3) * 2
            : Math.sin(animationTime * 3.5) * 14
          return String(offset)
        })

      // Calculate sector angle for all sector-based rendering
      const sectorAngle = (Math.PI * 2) / nodesData.length

      // Render static condition mean markers (only for non-baseline conditions)
      if (state.condition !== 1) {
        const condMeanMarkers = nodesData
          .filter(d => d.condMeanPx > 0)
          .map(d => {
            const meta = api.calibration.nodes[d.id]
            const raw_cond_mean = (api.static_raw[condKey] || {})[d.id]
            if (typeof raw_cond_mean !== 'number') return null

            // Apply transform before calculating z-score (same as data preprocessing)
            let transformed_cond_mean = raw_cond_mean
            if (meta.transform === 'log1p') {
              transformed_cond_mean = Math.log1p(Math.max(0, raw_cond_mean))
            }
            
            // Calculate z-score from transformed value
            const z_cond_mean = (transformed_cond_mean - meta.mu) / meta.sigma
            const r_cond_mean = R0 + zToDr(z_cond_mean, RDelta)
            const p = polar(cx, cy, r_cond_mean, d.theta)

            return { ...d, staticX: p.x, staticY: p.y }
          })
          .filter((d): d is NonNullable<typeof d> => d !== null)

        // Draw filled waveform bands for condition mean
        const condMeanWaveforms = condMeanMarkers.map(d => {
          const meta = api.calibration.nodes[d.id]
          const raw_cond_mean = (api.static_raw[condKey] || {})[d.id]
          if (typeof raw_cond_mean !== 'number') return null
          
          let transformed_cond_mean = raw_cond_mean
          if (meta.transform === 'log1p') {
            transformed_cond_mean = Math.log1p(Math.max(0, raw_cond_mean))
          }
          
          const z_cond_mean = (transformed_cond_mean - meta.mu) / meta.sigma
          const r_cond_mean = R0 + zToDr(z_cond_mean, RDelta)
          
          const angleStart = d.theta - sectorAngle / 2
          const numPoints = 20
          
          // Condition mean waveform (sine curve)
          const condMeanWave: {x: number, y: number}[] = []
          for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints
            const angle = angleStart + t * sectorAngle
            const sineFactor = Math.sin(t * Math.PI)
            const r = R0 + (r_cond_mean - R0) * sineFactor
            condMeanWave.push(polar(cx, cy, r, angle))
          }
          
          // Baseline arc (reverse direction for closed path)
          const baselineArc: {x: number, y: number}[] = []
          for (let i = numPoints; i >= 0; i--) {
            const t = i / numPoints
            const angle = angleStart + t * sectorAngle
            baselineArc.push(polar(cx, cy, R0, angle))
          }
          
          return { ...d, condMeanWave, baselineArc }
        }).filter((x): x is NonNullable<typeof x> => x !== null)
        
        gCondMean.selectAll<SVGPathElement, typeof condMeanWaveforms[0]>('path.cond-mean-wave')
          .data(condMeanWaveforms, d => d.id)
          .join('path')
          .attr('class', 'cond-mean-wave')
          .attr('d', d => d.condMeanWave.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '))
          .attr('fill', 'none')
          .attr('stroke', '#d4a574')
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.9)
      }

      // Draw sector boundaries and labels at baseline
      // Sector boundary lines
      gNodes.selectAll<SVGLineElement, typeof nodesData[0]>('line.sector-boundary')
        .data(nodesData, d => d.id)
        .join('line')
        .attr('class', 'sector-boundary')
        .attr('x1', cx)
        .attr('y1', cy)
        .attr('x2', d => {
          const angle = d.theta - sectorAngle / 2
          return cx + R0 * Math.cos(angle)
        })
        .attr('y2', d => {
          const angle = d.theta - sectorAngle / 2
          return cy + R0 * Math.sin(angle)
        })
        .attr('stroke', '#c9e0d5')
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.3)

      // Sector labels at baseline radius - positioned further out for visibility
      const labelG = gNodes.selectAll<SVGGElement, typeof nodesData[0]>('g.sector-label')
        .data(nodesData, d => d.id)
        .join('g')
        .attr('class', 'sector-label')
        .attr('cursor', 'pointer')
        .attr('pointer-events', 'auto')
        .on('click', (_, d) => {
          state.selectedNode = state.selectedNode === d.id ? undefined : d.id
          renderDetails(state.selectedNode || '')
          app.render()
        })

      const labelPos = nodesData.map(d => {
        const extra = (d.name === 'Cardiac Rhythm' || d.name === 'Sweat Level')
          ? 50
          : (d.name === 'Skin Temperature' ? 90 : 72)
        const p = polar(cx, cy, R0 + extra, d.theta)
        return { ...d, lx: p.x, ly: p.y }
      })

      labelG.selectAll('text')
        .data(d => [d])
        .join('text')
        .attr('x', d => labelPos.find(l => l.id === d.id)!.lx)
        .attr('y', d => labelPos.find(l => l.id === d.id)!.ly)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', d => state.selectedNode === d.id ? '#0b2e27' : '#184c3d')
        .attr('font-size', 14)
        .attr('font-weight', d => state.selectedNode === d.id ? 700 : 500)
        .attr('pointer-events', 'auto')
        .text(d => d.name)
        .raise()

      // Radial waveforms for current values
      const waveformData = nodesData.map(d => {
        const angleStart = d.theta - sectorAngle / 2
        
        // Current value radius at sector midpoint (calculate from z-score)
        const r_now = R0 + zToDr(d.z_now, RDelta)
        
        // Generate smooth waveform using sine interpolation
        const numPoints = 20
        const wavePoints: {x: number, y: number}[] = []
        
        for (let i = 0; i <= numPoints; i++) {
          const t = i / numPoints
          const angle = angleStart + t * sectorAngle
          
          // Sine-based interpolation from baseline at edges to current value at center
          const sineFactor = Math.sin(t * Math.PI)
          const r = R0 + (r_now - R0) * sineFactor
          
          const p = polar(cx, cy, r, angle)
          wavePoints.push(p)
        }
        
        // Baseline arc points (for closing the path)
        const baselinePoints: {x: number, y: number}[] = []
        for (let i = numPoints; i >= 0; i--) {
          const t = i / numPoints
          const angle = angleStart + t * sectorAngle
          const p = polar(cx, cy, R0, angle)
          baselinePoints.push(p)
        }
        
        return { ...d, wavePoints, baselinePoints }
      })

      gNodes.selectAll<SVGPathElement, typeof waveformData[0]>('path.waveform')
        .data(waveformData, d => d.id)
        .join('path')
        .attr('class', 'waveform')
        .attr('d', d => {
          const wavePath = d.wavePoints.map((p, i) => 
            `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
          ).join(' ')
          const baselinePath = d.baselinePoints.map(p => 
            `L ${p.x} ${p.y}`
          ).join(' ')
          return `${wavePath} ${baselinePath} Z`
        })
        .attr('fill', d => (['#cfeee4','#9ee4ce','#56b199','#178a74'][Math.max(0, Math.min(3, d.band))]))
        .attr('fill-opacity', d => state.selectedNode === d.id ? 0.85 : 0.65)
        .attr('stroke', d => (['#9bd7c4','#68c9b0','#35b79a','#146e5d'][Math.max(0, Math.min(3, d.band))]))
        .attr('stroke-width', d => state.selectedNode === d.id ? 2 : 1)
        .attr('stroke-opacity', 0.9)

      // Z-score labels at sector midpoint
      gNodes.selectAll<SVGTextElement, typeof nodesData[0]>('text.value-label')
        .data(nodesData, d => d.id)
        .join('text')
        .attr('class', 'value-label')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#0b2e27')
        .attr('font-size', 10)
        .attr('font-weight', 600)
        .attr('opacity', 0)
        .text(d => `z=${d.z_now.toFixed(2)}`)

      // Dim non-incident edges when a node is selected (by index to avoid name mismatches)
      if (state.selectedNode) {
        const selIdx = nodesData.find(nd => nd.id === state.selectedNode)?.i
        edgesSel.attr('stroke-opacity', e => {
          const baseOpacity = staticOpacity(e.static_conn)
          if (selIdx == null) return baseOpacity * 0.2
          return (e.indexA === selIdx || e.indexB === selIdx) ? baseOpacity : baseOpacity * 0.2
        })
      }

      legendRoot.attr('transform', `translate(12, ${Math.max(0, H - 280)})`)
      renderLegend(legendRoot, animationTime)
    }
  }

  function renderDetails(nodeId: string) {
    const el = document.getElementById('details')!
    if (!nodeId) { el.textContent = 'Select a node'; return }
    
    const meta = api.calibration.nodes[nodeId]
    if (!meta) { el.textContent = 'Node data not found'; return }
    
    // Get display name from NODE_ORDER
    const nodeOrderEntry = NODE_ORDER.find(n => n.id === nodeId)
    const name = nodeOrderEntry?.name || nodeId
    const descKey = normalizeNameForDesc(name)
    const what = WHAT_IT_IS[descKey] || ''
    
    // Always get current values from series at current time
    const nodeData = series.nodes[nodeId]
    if (!nodeData) { el.textContent = 'Series data not found'; return }
    
    const zNow = nodeData.level[state.timeIndex] ?? 0
    const rawNow = inverseFromZ(zNow, meta)
    const rawBase = inverseFromZ(0, meta)
    const rawCond = (api.static_raw[String(state.condition)] || {})[nodeId]
    
    const tLen = api.conditions[String(state.condition)].series.t.length
    const zPrev = nodeData.level[(state.timeIndex - 1 + tLen) % tLen] ?? zNow
    const dz = zNow - zPrev
    const deltaRaw = rawNow - rawBase
    const pct = (isFinite(rawBase) && Math.abs(rawBase) > 1e-9) ? (deltaRaw / rawBase) * 100 : 0
    const arrow = deltaRaw > 0 ? '↑' : (deltaRaw < 0 ? '↓' : '→')
    const condStr = typeof rawCond === 'number' ? `${rawCond.toFixed(meta.precision)} ${meta.units}` : 'N/A'
    
    el.innerHTML = `
      <div style="font-weight:700;">${name}</div>
      <div style="margin:6px 0 10px 0;">What it is: ${what}</div>
      <div>Currently at: ${rawNow.toFixed(meta.precision)} ${meta.units}</div>
      <div>vs baseline: ${rawNow.toFixed(meta.precision)} ${meta.units} vs ${rawBase.toFixed(meta.precision)} ${meta.units} (${pct.toFixed(1)}%) ${arrow}</div>
      <div>Condition mean: ${condStr}</div>
      <div>Baseline mean: ${rawBase.toFixed(meta.precision)} ${meta.units}</div>
      <div>Stats: z = ${zNow.toFixed(2)}; Δz = ${dz.toFixed(2)}</div>
    `
  }

  // Ticker
  function tick() {
    if (state.playing) {
      state.timeIndex = (state.timeIndex + 1) % tSeries.length
      scrubber.value = String(state.timeIndex)
      app.render()
      
      // Update side panel after render if a node is selected
      if (state.selectedNode) {
        renderDetails(state.selectedNode)
      }
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
    if (ev.key === 'Escape') { state.selectedNode = undefined; renderDetails(''); app.render() }
    if (['1','2','3','4'].includes(ev.key)) {
      conditionSelect.value = ev.key
      conditionSelect.dispatchEvent(new Event('change'))
    }
  })

  // Landing page functions (defined here to access state, app, etc)
  function showLandingStage(index: number) {
    landingStageIndex = Math.max(0, Math.min(LANDING_STAGES.length - 1, index))
    const stage = LANDING_STAGES[landingStageIndex]
    landingTitle.textContent = stage.title
    landingText.textContent = stage.text
    landingStage.textContent = `${landingStageIndex + 1} / ${LANDING_STAGES.length}`
    landingPrev.disabled = landingStageIndex === 0
    landingNext.disabled = landingStageIndex === LANDING_STAGES.length - 1
    applyLandingStageVisuals(landingStageIndex)
  }

  function applyLandingStageVisuals(stageIdx: number) {
    gNodes.selectAll('.landing-highlight').remove()
    gEdges.selectAll('.landing-highlight').remove()
    gCondMean.selectAll('.landing-highlight').remove()
    
    // Remove backdrop dimming for stages 2-6
    const backdrop = landingOverlay.querySelector('.landing-backdrop') as HTMLElement
    if (stageIdx === 0) {
      backdrop.style.background = 'rgba(0,0,0,0.5)'
    } else {
      backdrop.style.background = 'rgba(0,0,0,0)'
    }
    
    switch(stageIdx) {
      case 0:
        // Stage 1: Large centered, graph dimmed
        landingCard.style.position = 'fixed'
        landingCard.style.left = '50%'
        landingCard.style.top = '50%'
        landingCard.style.transform = 'translate(-50%, -50%)'
        landingCard.style.width = '90%'
        landingCard.style.maxWidth = '600px'
        landingCard.style.bottom = 'auto'
        landingCard.style.maxHeight = '80vh'
        svg.style('opacity', '0.1')
        state.playing = false
        break
        
      case 1:
        // Stage 2: Card moves to side, graph visible
        landingCard.style.position = 'fixed'
        landingCard.style.width = '45%'
        landingCard.style.maxWidth = '400px'
        landingCard.style.left = '8px'
        landingCard.style.top = '60px'
        landingCard.style.transform = 'none'
        landingCard.style.bottom = 'auto'
        landingCard.style.maxHeight = '80vh'
        svg.style('opacity', '1')
        state.condition = 1
        state.playing = false
        conditionSelect.value = '1'
        app.render()
        break
        
      case 2:
        // Stage 3: Show waveforms with hue - Heart Rate wave pulses through hue intensity
        svg.style('opacity', '1')
        state.playing = false
        state.timeIndex = Math.floor(tSeries.length / 2)
        scrubber.value = String(state.timeIndex)
        app.render()
        // Animate Heart Rate waveform hue (Second node, index 1)
        setTimeout(() => {
          const allWaveforms = gNodes.selectAll('path.waveform').nodes()
          if (allWaveforms.length >= 8) {
            const muscleTensionWave = d3.select(allWaveforms[1])
            // Pulse through hue palette: light -> strong -> light
            muscleTensionWave
              .style('animation', 'hueShift 2s infinite')
          }
        }, 100)
        break
        
      case 3:
        // Stage 4: Highlight two sample edges (push and pull)
        svg.style('opacity', '1')
        state.playing = false
        // Ensure no node selection is dimming edges
        state.selectedNode = undefined
        app.render()

        const tryHighlightEdges = (attempt = 0) => {
          const allEdges = gEdges.selectAll<SVGPathElement, any>('path.edge').nodes()
          if (allEdges.length < 2) {
            if (attempt < 5) return setTimeout(() => tryHighlightEdges(attempt + 1), 200)
            return
          }
          // Find one positive sync (push) and one negative sync (pull)
          let pushEdge: SVGPathElement | null = null
          let pullEdge: SVGPathElement | null = null

          gEdges.selectAll<SVGPathElement, any>('path.edge').each(function(d) {
            if (!pushEdge && d && d.avg_sync >= 0) pushEdge = this as SVGPathElement
            if (!pullEdge && d && d.avg_sync < 0) pullEdge = this as SVGPathElement
          })

          if (!pushEdge) pushEdge = allEdges[0] as SVGPathElement
          if (!pullEdge) pullEdge = allEdges[Math.min(1, allEdges.length - 1)] as SVGPathElement

          if (pushEdge) {
            d3.select(pushEdge)
              .attr('stroke-width', 6)
              .attr('stroke', '#ff6b6b')
              .attr('opacity', 0.95)
              .raise()
          }
          if (pullEdge && pullEdge !== pushEdge) {
            d3.select(pullEdge)
              .attr('stroke-width', 6)
              .attr('stroke', '#4ecdc4')
              .attr('opacity', 0.95)
              .raise()
          }

          // If the landing overlay is still active on stage 4, re-apply highlight periodically
          if (landingOverlay.classList.contains('active') && landingStageIndex === 3) {
            setTimeout(() => tryHighlightEdges(0), 600)
          }
        }

        setTimeout(() => tryHighlightEdges(0), 250)
        break
        
      case 4:
        // Stage 5: Switch to stress condition, highlight condition mean
        svg.style('opacity', '1')
        state.condition = 2
        state.playing = false
        conditionSelect.value = '2'
        app.render()
        setTimeout(() => {
          gCondMean.selectAll('path.cond-mean-wave')
            .attr('stroke', '#d4a574')
            .attr('stroke-width', 3)
            .attr('stroke-opacity', 1)
            .style('filter', 'drop-shadow(0 0 8px rgba(212,165,116,0.6))')
        }, 100)
        break
        
      case 5:
        // Stage 6: Close card, enable play, show info icon in legend
        svg.style('opacity', '1')
        state.playing = true
        app.render()
        // Close the overlay after a short delay to let user read the final message
        setTimeout(() => {
          hideLanding()
        }, 2000)
        break
    }
  }

  function hideLanding() {
    landingOverlay.classList.remove('active')
    localStorage.setItem('landingViewed', 'true')
    svg.style('opacity', '1')
    state.playing = true
    state.condition = 1
    conditionSelect.value = '1'
    app.render()
  }

  function initLanding() {
    const viewed = localStorage.getItem('landingViewed')
    console.log('initLanding called, viewed:', viewed)
    console.log('landingOverlay:', landingOverlay)
    if (!viewed) {
      console.log('Adding active class to overlay')
      landingOverlay.classList.add('active')
      showLandingStage(0)
    }
    
    // Set up callback for info icon in legend (start from stage 2)
    reopenTutorial = () => {
      landingStageIndex = 1
      localStorage.removeItem('landingViewed')
      landingOverlay.classList.add('active')
      showLandingStage(1)
    }
    
    landingPrev.addEventListener('click', () => showLandingStage(landingStageIndex - 1))
    landingNext.addEventListener('click', () => {
      if (landingStageIndex < LANDING_STAGES.length - 1) {
        showLandingStage(landingStageIndex + 1)
      } else {
        hideLanding()
      }
    })
    landingClose.addEventListener('click', hideLanding)
  }

  initLanding()
  app.render()
  tick()
}

main().catch(err => console.error(err))
