// Locally rendered SVG road map (no map API, no key). Routes drawn here are the paths returned by the C engine.
const COL = { station: "#3b82f6", hospital: "#ef4444", junction: "#64748b", landmark: "#a78bfa" };
const SEV = { P1: "#ef4444", P2: "#f97316", P3: "#f59e0b", P4: "#22c55e" };
const AMB = { AVAILABLE: "#22c55e", OUT_OF_SERVICE: "#64748b" };
const L = (i) => String.fromCharCode(65 + Number(i));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function drawMap(nodes, edges, { routes = [], ambs = [], emgs = [], km = true } = {}) {
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const roads = edges.map((e) => {
    const a = by[e.u], b = by[e.v];
    if (!a || !b) return "";
    return `<line class="road" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` +
      (km ? `<text class="km" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}">${e.km}</text>` : "");
  }).join("");
  const lines = routes.map((r) => {
    const pts = (r.path || []).map((i) => (by[i] ? `${by[i].x},${by[i].y}` : "")).filter(Boolean).join(" ");
    return pts ? `<polyline class="route ${r.cls || ""}" points="${pts}"/>` : "";
  }).join("");
  const dots = nodes.map((n) => {
    const c = COL[n.kind] || COL.junction;
    let shape;
    if (n.kind === "hospital") shape = `<rect x="${n.x - 13}" y="${n.y - 13}" width="26" height="26" rx="5" fill="${c}"/><path d="M${n.x - 6} ${n.y}h12M${n.x} ${n.y - 6}v12" stroke="#fff" stroke-width="3"/>`;
    else if (n.kind === "station") shape = `<rect x="${n.x - 12}" y="${n.y - 12}" width="24" height="24" rx="4" fill="${c}"/><text class="nl" x="${n.x}" y="${n.y + 4}">${L(n.id)}</text>`;
    else shape = `<circle cx="${n.x}" cy="${n.y}" r="11" fill="${c}"/><text class="nl" x="${n.x}" y="${n.y + 4}">${L(n.id)}</text>`;
    const label = n.kind === "hospital" ? `${L(n.id)} · ${n.name}` : n.name;
    return `<g><title>${L(n.id)} · ${esc(n.name)} (${n.kind})</title>${shape}<text class="nm" x="${n.x}" y="${n.y + 27}">${esc(label)}</text></g>`;
  }).join("");
  const slot = {};
  const ambDots = ambs.map((a) => {
    const n = by[a.node]; if (!n) return "";
    const k = slot[a.node] = (slot[a.node] || 0) + 1;
    const x = n.x + 8 + k * 11, y = n.y - 18;
    const c = AMB[a.status] || "#3b82f6";
    return `<g><title>${esc(a.id)} · ${esc(String(a.status).replace(/_/g, " "))}</title><circle cx="${x}" cy="${y}" r="8" fill="${c}" stroke="#0c1629" stroke-width="2"/><path d="M${x - 4} ${y}h8M${x} ${y - 4}v8" stroke="#fff" stroke-width="2"/></g>`;
  }).join("");
  const eslot = {};
  const emgDots = emgs.map((e) => {
    const n = by[e.node]; if (!n) return "";
    const k = eslot[e.node] = (eslot[e.node] || 0) + 1;
    const x = n.x - 8 - k * 11, y = n.y - 18;
    return `<g><title>Emergency ${esc(e.severity)}</title><circle class="pulse" cx="${x}" cy="${y}" r="8" fill="${SEV[e.severity] || "#ef4444"}"/><text class="nl" x="${x}" y="${y + 3.5}">!</text></g>`;
  }).join("");
  return `<div class="mapwrap"><svg class="map" viewBox="0 0 870 540" role="img" aria-label="Simulated road network map">${roads}${lines}${dots}${ambDots}${emgDots}</svg><span class="simtag">SIMULATED MAP</span></div>`;
}

export const legend = () => `<div class="legend"><span><i style="background:#3b82f6"></i>Station</span><span><i style="background:#ef4444"></i>Hospital</span><span><i style="background:#64748b"></i>Junction</span><span><i style="background:#22c55e"></i>Ambulance</span><span><i class="ln" style="background:#3b82f6"></i>To patient</span><span><i class="ln" style="background:#ef4444"></i>To hospital</span></div>`;
