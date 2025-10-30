import * as T from "d3";
async function it(s) {
  const i = "/StressPropagation/" + "group.json", t = await fetch(i);
  if (!t.ok) throw new Error(`Failed to fetch ${s}: ${t.status}`);
  return await t.json();
}
const W = 2.5;
function ot(s, n) {
  return Math.max(-W, Math.min(W, s)) / W * n;
}
function rt(s, n, i, t) {
  return { x: s + i * Math.cos(t), y: n + i * Math.sin(t) };
}
function ct(s, n, i, t) {
  const d = s - 2 * n, h = s + 2 * n;
  return (f) => {
    if (!isFinite(f)) return i;
    const y = (f - d) / Math.max(1e-9, h - d);
    return Math.max(i, Math.min(t, i + y * (t - i)));
  };
}
const M = [
  { name: "Cardiac Rhythm", id: "node_cardiac_rhythm" },
  { name: "Heart Rate", id: "node_heart_rate" },
  { name: "Breathing Rate", id: "node_breathing_rate" },
  { name: "Breathing Depth", id: "node_breathing_depth" },
  { name: "Sweat Level", id: "node_sweat_level" },
  { name: "Sweat Reactivity", id: "node_sweat_reactivity" },
  { name: "Skin Temperature", id: "node_skin_temperature" },
  { name: "Muscle Tension", id: "node_muscle_tension" }
], nt = T.select("#canvas"), B = nt.append("svg"), Z = B.append("g").attr("class", "edges"), U = B.append("g").attr("class", "nodes"), V = B.insert("g", ":first-child").attr("class", "bg"), tt = document.getElementById("playPause"), z = document.getElementById("scrubber"), D = document.getElementById("conditionSelect");
let E = 800, $ = 600, P = 0, C = 0, J = 180, at = 140;
function et() {
  const s = nt.node().getBoundingClientRect();
  E = Math.max(640, s.width), $ = Math.max(480, s.height), P = E / 2, C = $ / 2, J = Math.min(E, $) * 0.28, at = Math.min(E, $) * 0.22, B.attr("width", E).attr("height", $);
}
function q(s, n) {
  const i = s * n.sigma + n.mu;
  return n.inverse === "expm1" ? Math.expm1(Math.max(-50, i)) : i;
}
function dt(s) {
  const n = {};
  for (const { id: i } of M) {
    const t = s.nodes[i], d = ct(t.mu, t.sigma, 14, 40);
    n[i] = d;
  }
  return n;
}
function lt(s) {
  s.selectAll("*").remove();
  const n = 10, i = 10;
  s.append("text").text("Legend").attr("x", n).attr("y", i + 10).attr("fill", "#6b7280").attr("font-size", 12);
  const t = s.append("g").attr("transform", `translate(${n + 10}, ${i + 30})`), d = 18, h = 12, f = 16;
  t.append("circle").attr("r", d).attr("fill", "#9ca3af").attr("fill-opacity", 0.3), t.append("circle").attr("r", h + 6).attr("fill", "none").attr("stroke", "#2563eb").attr("stroke-opacity", 0.2).attr("stroke-width", 8), t.append("circle").attr("r", h).attr("fill", "#93c5fd"), t.append("circle").attr("r", f).attr("fill", "none").attr("stroke", "#111827").attr("stroke-width", 1.5), s.append("text").text("Radius = Δ vs baseline (level_z)").attr("x", n + 50).attr("y", i + 34).attr("fill", "#6b7280").attr("font-size", 12), s.append("text").text("Size = raw now; inner = baseline mean; tick = condition mean").attr("x", n + 50).attr("y", i + 50).attr("fill", "#6b7280").attr("font-size", 12), s.append("text").text("Halo = activity bands").attr("x", n + 50).attr("y", i + 66).attr("fill", "#6b7280").attr("font-size", 12);
  const y = i + 90, R = s.append("g").attr("transform", `translate(${n}, ${y})`), F = T.line();
  R.append("path").attr("d", F([{ x: 0, y: 0 }, { x: 60, y: 0 }]) || "").attr("stroke", "#2563eb").attr("fill", "none").attr("stroke-width", 3).attr("stroke-dasharray", "6 6").attr("stroke-dashoffset", "-6"), s.append("text").text("In-sync (push)").attr("x", n + 70).attr("y", y + 4).attr("fill", "#6b7280").attr("font-size", 12), R.append("path").attr("d", F([{ x: 0, y: 20 }, { x: 60, y: 20 }]) || "").attr("stroke", "#2563eb").attr("fill", "none").attr("stroke-width", 3).attr("stroke-dasharray", "6 6").attr("stroke-dashoffset", "6"), s.append("text").text("Opposed (ping-pong)").attr("x", n + 70).attr("y", y + 24).attr("fill", "#6b7280").attr("font-size", 12);
}
async function pt() {
  et(), window.addEventListener("resize", () => {
    et(), b && b.render();
  });
  const s = window.matchMedia("(prefers-reduced-motion: reduce)").matches, n = await it(), i = parseInt(localStorage.getItem("cond") || "1", 10) || 1, t = {
    playing: !0,
    timeIndex: 0,
    reducedMotion: s,
    condition: i
  };
  let d = String(t.condition), h = n.conditions[d].series, f = h.t;
  const y = dt(n.calibration);
  let R = {};
  function F() {
    var r;
    R = {};
    for (const { id: g } of M) {
      const l = ((r = h.nodes[g]) == null ? void 0 : r.slope) ?? [], v = new Array(l.length).fill(0);
      let p = 0;
      for (let w = 1; w < l.length; w++)
        p = 0.3 * Math.abs((l[w] ?? 0) - (l[w - 1] ?? 0)) + 0.7 * p, v[w] = p > 0.6 ? 3 : p > 0.3 ? 2 : p > 0.1 ? 1 : 0;
      R[g] = v;
    }
  }
  F(), z.max = String(Math.max(0, f.length - 1)), z.value = String(t.timeIndex), tt.addEventListener("click", () => {
    t.playing = !t.playing, tt.textContent = t.playing ? "Pause" : "Play";
  }), z.addEventListener("input", () => {
    t.timeIndex = Math.min(Math.max(0, parseInt(z.value, 10) || 0), f.length - 1), b.render();
  });
  const b = {
    render() {
      Z.selectAll("*").remove(), U.selectAll("*").remove(), V.selectAll("*").remove(), B.selectAll(".r0").data([0]).join("circle").attr("class", "r0").attr("cx", P).attr("cy", C).attr("r", J).attr("fill", "none").attr("stroke", "#2a2f3a"), V.append("rect").attr("x", 0).attr("y", 0).attr("width", E).attr("height", $).attr("fill", "transparent").on("click", () => {
        t.selectedNode = void 0, j(null), b.render();
      });
      const r = Math.PI * 2 / M.length, g = M.map((e, a) => {
        var Y, Q;
        const o = n.calibration.nodes[e.id], c = ((Y = h.nodes[e.id]) == null ? void 0 : Y.level[t.timeIndex]) ?? 0, m = J + ot(c, at), x = a * r - Math.PI / 2, u = rt(P, C, m, x), I = q(c, o), S = y[e.id](I), G = q(0, o), L = y[e.id](G), K = ((Q = R[e.id]) == null ? void 0 : Q[t.timeIndex]) ?? 0, N = (n.static_raw[d] || {})[e.id], st = typeof N == "number" ? y[e.id](N) : 0;
        return { ...e, i: a, theta: x, x: u.x, y: u.y, raw_now: I, sizePx: S, baselinePx: L, z_now: c, band: K, tickR: st };
      }), l = n.conditions[d].series.edges, v = Object.entries(l), p = v.filter(([, e]) => {
        const a = e.sync[t.timeIndex] ?? 0, o = e.conf[t.timeIndex] ?? 0;
        return Math.abs(a) >= 0.15 && o >= 0.2;
      });
      console.log(`t=${t.timeIndex}, cond=${d}, passed=${p.length}/${v.length}, edgeEntries:`, v.length), p.length > 0 && console.log("Sample passed edge:", p[0][0], "sync=", p[0][1].sync[t.timeIndex], "conf=", p[0][1].conf[t.timeIndex]);
      const k = p.map((e) => {
        const [a, o] = e[0].split("|"), c = M.findIndex((N) => N.name === a), m = M.findIndex((N) => N.name === o), x = g[c], u = g[m], I = x.x - u.x, S = x.y - u.y, G = Math.sqrt(I * I + S * S), L = n.conditions[d].static.edges[e[0]], K = ((L == null ? void 0 : L.static_conn) ?? 0) * (e[1].conf[t.timeIndex] ?? 0);
        return { d: e, dist: G, sc: K };
      }).sort((e, a) => a.sc - e.sc).slice(0, 12);
      console.log("visibleEdges after Top-K:", k.length), k.length > 0 && console.log("First visible edge:", k[0].d[0], "dist=", k[0].dist, "sc=", k[0].sc);
      const H = T.line().curve(T.curveLinear);
      Z.append("line").attr("x1", P - 50).attr("y1", C).attr("x2", P + 50).attr("y2", C).attr("stroke", "red").attr("stroke-width", 3);
      const O = Z.selectAll("path.edge").data(k, (e) => e.d[0]).join("path").attr("class", "edge").attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-opacity", (e) => {
        const a = e.d[1].conf[t.timeIndex] ?? 0, o = Math.min(1, Math.max(0.2, a)), c = Math.min(E, $) * 0.5, m = 0.3 + 0.7 * (1 - Math.min(1, e.dist / c));
        return Math.min(1, o * m);
      }).attr("stroke-width", (e) => {
        const a = e.d[0], o = n.conditions[d].static.edges[a];
        return 1 + 4 * (o ? o.static_conn : 0.2);
      }).attr("d", (e) => {
        const [a, o] = e.d[0].split("|"), c = M.findIndex((S) => S.name === a), m = M.findIndex((S) => S.name === o);
        if (c < 0 || m < 0)
          return console.warn("Edge node not found:", a, o, "ia=", c, "ib=", m), "";
        const x = g[c], u = g[m], I = H([{ x: x.x, y: x.y }, { x: u.x, y: u.y }]) || "";
        return !I && k.indexOf(e) === 0 && console.log("First edge path:", a, "->", o, "na:", x.x, x.y, "nb:", u.x, u.y, "d:", I), I;
      });
      O.attr("stroke-dasharray", "6 6").attr("stroke-dashoffset", (e) => {
        const o = (e.d[1].sync[t.timeIndex] ?? 0) >= 0 || t.timeIndex % 2 === 0 ? 1 : -1;
        return String(-t.timeIndex * 2 * o);
      });
      const _ = U.selectAll("g.node").data(g, (e) => e.id).join((e) => {
        const a = e.append("g").attr("class", "node");
        return a.append("circle").attr("class", "baseline").attr("fill", "#4b5563").attr("fill-opacity", 0.3), a.append("circle").attr("class", "main").attr("fill", "#93c5fd"), a.append("circle").attr("class", "tick").attr("fill", "none").attr("stroke", "#111827").attr("stroke-width", 1.5), a.append("text").attr("class", "label").attr("text-anchor", "middle").attr("dy", "0.32em"), a.attr("tabindex", 0), a.on("keydown", (o, c) => {
          (o.key === "Enter" || o.key === " ") && (t.selectedNode = t.selectedNode === c.id ? void 0 : c.id, j(c), b.render());
        }), a;
      });
      if (_.attr("transform", (e) => `translate(${e.x},${e.y})`), _.select("circle.baseline").attr("r", (e) => e.baselinePx), _.select("circle.main").attr("r", (e) => e.sizePx).attr("fill-opacity", (e) => [0.3, 0.6, 0.8, 1][e.band]), _.select("circle.tick").attr("r", (e) => t.selectedNode === e.id ? e.tickR : 0), _.select("text.label").text((e) => `${e.raw_now.toFixed(n.calibration.nodes[e.id].precision)}`).style("display", (e) => e.sizePx < 10 ? "none" : "block"), _.on("click", (e, a) => {
        t.selectedNode = t.selectedNode === a.id ? void 0 : a.id, j(a);
      }), t.selectedNode) {
        const e = M.find((a) => a.id === t.selectedNode).name;
        O.attr("stroke-opacity", (a) => {
          const [o, c] = a.d[0].split("|"), m = Math.min(1, a.d[1].conf[t.timeIndex] ?? 0);
          return o === e || c === e ? m : m * 0.2;
        });
      }
      lt(B.append("g").attr("transform", `translate(12, ${$ - 110})`));
    }
  };
  function j(r) {
    var e;
    const g = document.getElementById("details");
    if (!r) {
      g.textContent = "Select a node";
      return;
    }
    const l = n.calibration.nodes[r.id], v = r.raw_now, p = q(0, l), w = (n.static_raw[String(t.condition)] || {})[r.id], A = r.z_now, k = ((e = n.conditions[String(t.condition)].series.nodes[r.id]) == null ? void 0 : e.level[(t.timeIndex - 1 + n.conditions[String(t.condition)].series.t.length) % n.conditions[String(t.condition)].series.t.length]) ?? A, H = A - k, O = v - p, _ = typeof w == "number" ? `${w.toFixed(l.precision)} ${l.units}` : "N/A";
    g.innerHTML = `
      <div><strong>${r.name}</strong></div>
      <div>Now: ${v.toFixed(l.precision)} ${l.units}</div>
      <div>Δ vs baseline: ${O.toFixed(l.precision)} ${l.units}</div>
      <div>z: ${A.toFixed(2)}  Δz: ${H.toFixed(2)}</div>
      <div>Condition mean: ${_}</div>
      <div>Baseline mean: ${p.toFixed(l.precision)} ${l.units}</div>
    `;
  }
  function X() {
    t.playing && (t.timeIndex = (t.timeIndex + 1) % f.length, z.value = String(t.timeIndex), b.render());
    const r = t.reducedMotion ? 800 : 450;
    setTimeout(X, r);
  }
  D.value = d, D.addEventListener("change", () => {
    t.condition = parseInt(D.value, 10), d = String(t.condition), h = n.conditions[d].series, f = h.t, F(), z.max = String(Math.max(0, f.length - 1)), t.timeIndex = Math.min(t.timeIndex, f.length - 1), z.value = String(t.timeIndex), localStorage.setItem("cond", d), b.render();
  }), window.addEventListener("keydown", (r) => {
    r.key === "Escape" && (t.selectedNode = void 0, j(null), b.render()), ["1", "2", "3", "4"].includes(r.key) && (D.value = r.key, D.dispatchEvent(new Event("change")));
  }), b.render(), X();
}
pt().catch((s) => console.error(s));
