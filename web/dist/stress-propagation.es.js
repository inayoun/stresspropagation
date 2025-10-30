import * as R from "d3";
async function Y(s = "/group.json") {
  const n = await fetch(s);
  if (!n.ok) throw new Error(`Failed to fetch ${s}: ${n.status}`);
  return await n.json();
}
const E = 2.5;
function tt(s, n) {
  return Math.max(-E, Math.min(E, s)) / E * n;
}
function et(s, n, e, i) {
  return { x: s + e * Math.cos(i), y: n + e * Math.sin(i) };
}
function nt(s, n, e, i) {
  const l = s - 2 * n, w = s + 2 * n;
  return (h) => {
    if (!isFinite(h)) return e;
    const S = (h - l) / Math.max(1e-9, w - l);
    return Math.max(e, Math.min(i, e + S * (i - e)));
  };
}
const u = [
  { name: "Cardiac Rhythm", id: "node_cardiac_rhythm" },
  { name: "Heart Rate", id: "node_heart_rate" },
  { name: "Breathing Rate", id: "node_breathing_rate" },
  { name: "Breathing Depth", id: "node_breathing_depth" },
  { name: "Sweat Level", id: "node_sweat_level" },
  { name: "Sweat Reactivity", id: "node_sweat_reactivity" },
  { name: "Skin Temperature", id: "node_skin_temperature" },
  { name: "Muscle Tension", id: "node_muscle_tension" }
], J = R.select("#canvas"), z = J.append("svg"), O = z.append("g").attr("class", "edges"), T = z.append("g").attr("class", "nodes"), G = document.getElementById("playPause"), I = document.getElementById("scrubber");
let k = 800, b = 600, N = 0, $ = 0, A = 180, K = 140;
function H() {
  const s = J.node().getBoundingClientRect();
  k = Math.max(640, s.width), b = Math.max(480, s.height), N = k / 2, $ = b / 2, A = Math.min(k, b) * 0.28, K = Math.min(k, b) * 0.22, z.attr("width", k).attr("height", b);
}
function Z(s, n) {
  const e = s * n.sigma + n.mu;
  return n.inverse === "expm1" ? Math.expm1(Math.max(-50, e)) : e;
}
function at(s) {
  const n = {};
  for (const { id: e } of u) {
    const i = s.nodes[e], l = nt(i.mu, i.sigma, 8, 28);
    n[e] = l;
  }
  return n;
}
function st(s) {
  s.selectAll("*").remove(), s.append("text").text("Legend:").attr("x", 12).attr("y", 20).attr("fill", "#9ca3af").attr("font-size", 12), s.append("text").text("Radius = Δ vs baseline (level_z)").attr("x", 12).attr("y", 36).attr("fill", "#9ca3af").attr("font-size", 12), s.append("text").text("Size = raw now").attr("x", 12).attr("y", 52).attr("fill", "#9ca3af").attr("font-size", 12);
}
async function it() {
  var j;
  H(), window.addEventListener("resize", () => {
    H(), _ && _.render();
  });
  const s = window.matchMedia("(prefers-reduced-motion: reduce)").matches, n = await Y("../artifacts/api/group.json"), e = {
    playing: !1,
    timeIndex: 0,
    reducedMotion: s,
    condition: 1
  }, i = String(e.condition), l = n.conditions[i].series, w = l.t, h = at(n.calibration), S = {};
  for (const { id: o } of u) {
    const c = ((j = l.nodes[o]) == null ? void 0 : j.slope) ?? [], m = new Array(c.length).fill(0);
    let x = 0;
    for (let p = 1; p < c.length; p++)
      x = 0.3 * Math.abs((c[p] ?? 0) - (c[p - 1] ?? 0)) + 0.7 * x, m[p] = x > 0.6 ? 3 : x > 0.3 ? 2 : x > 0.1 ? 1 : 0;
    S[o] = m;
  }
  I.max = String(Math.max(0, w.length - 1)), I.value = String(e.timeIndex), G.addEventListener("click", () => {
    e.playing = !e.playing, G.textContent = e.playing ? "Pause" : "Play";
  }), I.addEventListener("input", () => {
    e.timeIndex = Math.min(Math.max(0, parseInt(I.value, 10) || 0), w.length - 1), _.render();
  });
  const _ = {
    render() {
      O.selectAll("*").remove(), T.selectAll("*").remove(), z.selectAll(".r0").data([0]).join("circle").attr("class", "r0").attr("cx", N).attr("cy", $).attr("r", A).attr("fill", "none").attr("stroke", "#2a2f3a");
      const o = Math.PI * 2 / u.length, c = u.map((t, a) => {
        var F, C;
        const r = n.calibration.nodes[t.id], d = ((F = l.nodes[t.id]) == null ? void 0 : F.level[e.timeIndex]) ?? 0, f = A + tt(d, K), M = a * o - Math.PI / 2, v = et(N, $, f, M), y = Z(d, r), X = h[t.id](y), q = Z(0, r), Q = h[t.id](q), U = ((C = S[t.id]) == null ? void 0 : C[e.timeIndex]) ?? 0, P = (n.static_raw[i] || {})[t.id], V = typeof P == "number" ? h[t.id](P) : 0;
        return { ...t, i: a, theta: M, x: v.x, y: v.y, raw_now: y, sizePx: X, baselinePx: Q, z_now: d, band: U, tickR: V };
      }), m = n.conditions[i].series.edges, p = Object.entries(m).filter(([, t]) => {
        const a = t.sync[e.timeIndex] ?? 0, r = t.conf[e.timeIndex] ?? 0;
        return Math.abs(a) >= 0.25 && r >= 0.25;
      }), D = R.line().curve(R.curveLinear), L = O.selectAll("path.edge").data(p).join("path").attr("class", "edge").attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-opacity", (t) => {
        const a = t[1].conf[e.timeIndex] ?? 0;
        return Math.min(1, a);
      }).attr("stroke-width", (t) => {
        const a = t[0], r = n.conditions[i].static.edges[a];
        return 1 + 4 * (r ? r.static_conn : 0.2);
      }).attr("d", (t) => {
        const [a, r] = t[0].split("|"), d = u.findIndex((y) => y.name === a), f = u.findIndex((y) => y.name === r);
        if (d < 0 || f < 0) return "";
        const M = c[d], v = c[f];
        return D([{ x: M.x, y: M.y }, { x: v.x, y: v.y }]) || "";
      });
      L.attr("stroke-dasharray", "6 6").attr("stroke-dashoffset", (t) => {
        const r = (t[1].sync[e.timeIndex] ?? 0) >= 0 || e.timeIndex % 2 === 0 ? 1 : -1;
        return String(-e.timeIndex * 2 * r);
      });
      const g = T.selectAll("g.node").data(c, (t) => t.id).join((t) => {
        const a = t.append("g").attr("class", "node");
        return a.append("circle").attr("class", "baseline").attr("fill", "#4b5563").attr("fill-opacity", 0.3), a.append("circle").attr("class", "main").attr("fill", "#93c5fd"), a.append("circle").attr("class", "tick").attr("fill", "none").attr("stroke", "#111827").attr("stroke-width", 1.5), a.append("text").attr("class", "label").attr("text-anchor", "middle").attr("dy", "0.32em"), a;
      });
      if (g.attr("transform", (t) => `translate(${t.x},${t.y})`), g.select("circle.baseline").attr("r", (t) => t.baselinePx), g.select("circle.main").attr("r", (t) => t.sizePx).attr("fill-opacity", (t) => [0.3, 0.6, 0.8, 1][t.band]), g.select("circle.tick").attr("r", (t) => e.selectedNode === t.id ? t.tickR : 0), g.select("text.label").text((t) => `${t.raw_now.toFixed(n.calibration.nodes[t.id].precision)}`).style("display", (t) => t.sizePx < 10 ? "none" : "block"), g.on("click", (t, a) => {
        e.selectedNode = e.selectedNode === a.id ? void 0 : a.id, W(a);
      }), e.selectedNode) {
        const t = u.find((a) => a.id === e.selectedNode).name;
        L.attr("stroke-opacity", (a) => {
          const [r, d] = a[0].split("|"), f = Math.min(1, a[1].conf[e.timeIndex] ?? 0);
          return r === t || d === t ? f : f * 0.2;
        });
      }
      st(z.append("g").attr("transform", `translate(12, ${b - 90})`));
    }
  };
  function W(o) {
    const c = document.getElementById("details"), m = n.calibration.nodes[o.id];
    c.textContent = `${o.name}: ${o.raw_now.toFixed(m.precision)} ${m.units}`;
  }
  function B() {
    e.playing && (e.timeIndex = (e.timeIndex + 1) % w.length, I.value = String(e.timeIndex), _.render());
    const o = e.reducedMotion ? 800 : 450;
    setTimeout(B, o);
  }
  _.render(), B();
}
it().catch((s) => console.error(s));
