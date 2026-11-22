import { api, API_BASE } from "./api.js";
import { drawMap, legend } from "./map.js";

/* ============ helpers ============ */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const L = (i) => String.fromCharCode(65 + Number(i));
const fdt = (t) => (t ? new Date(t).toLocaleString() : "—");
const km = (x) => (x == null ? "—" : `${Number(x).toFixed(1)} km`);
const mins = (x) => (x == null ? "—" : `${Math.round(x)} min`);
const pstr = (p) => (p && p.length ? p.map(L).join(" → ") : "—");
const S = { nodes: [], edges: [], by: {} };
const nodeOpts = () => S.nodes.map((n) => [n.id, `${L(n.id)} · ${n.name}`]);
const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(l)}</option>`).join("");
const field = (label, html) => `<label class="f"><span>${label}</span>${html}</label>`;
const empty = (t, s = "") => `<div class="empty"><b>${t}</b><small>${s}</small></div>`;
const demoTag = (d) => (d ? ' <span class="demo">DEMO</span>' : "");
const banner = () => '<div class="banner"><b>DEMO DATA</b> — sample records are marked DEMO. Restore them any time from Settings.</div>';

const SEV = { P1: ["CRITICAL", "#ef4444"], P2: ["HIGH", "#f97316"], P3: ["MEDIUM", "#f59e0b"], P4: ["LOW", "#22c55e"] };
const CATS = ["Medical Emergency", "Accident", "Cardiac Emergency", "Trauma", "Fire-related Medical Emergency", "Other"];
const AMBST = { AVAILABLE: "green", ASSIGNED: "blue", EN_ROUTE: "blue", AT_PATIENT: "amber", TRANSPORTING: "red", RETURNING: "blue", OUT_OF_SERVICE: "grey" };
const EMGST = { PENDING: "amber", DISPATCHED: "blue", EN_ROUTE: "blue", AT_PATIENT: "amber", PICKED_UP: "amber", HOSPITAL_SELECTED: "blue", TRANSPORTING: "red", COMPLETED: "green", CANCELLED: "grey" };
const CSSCOL = { green: "#22c55e", blue: "#3b82f6", amber: "#f59e0b", red: "#ef4444", grey: "#64748b" };
const EQUIP = ["oxygen", "defibrillator", "cardiac_monitor", "ventilator", "trauma_kit"];
const FAC = ["emergency", "trauma", "cardiology", "icu", "burn", "general"];
const BUSY = ["ASSIGNED", "EN_ROUTE", "AT_PATIENT", "TRANSPORTING", "RETURNING"];
const TERM = ["COMPLETED", "CANCELLED"];
const FLOW = [["PENDING", "Received"], ["DISPATCHED", "Dispatched"], ["EN_ROUTE", "En route"], ["AT_PATIENT", "At patient"], ["PICKED_UP", "Picked up"], ["HOSPITAL_SELECTED", "Hospital selected"], ["TRANSPORTING", "Transporting"], ["COMPLETED", "Completed"]];
const sevB = (s) => `<span class="badge" style="--c:${SEV[s][1]}">${s} · ${SEV[s][0]}</span>`;
const stB = (s, m) => `<span class="badge ${m[s] || "grey"}">${esc(String(s).replace(/_/g, " "))}</span>`;
const nextLabel = (e) => FLOW[FLOW.findIndex((f) => f[0] === e.status) + 1]?.[1] || "";

const bars = (rows) => {
  const m = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => !r.value)) return empty("No data yet", "Numbers appear as requests are created.");
  return `<div class="bars">${rows.map((r) => `<div class="bar"><span>${esc(r.label)}</span><i><u style="width:${(r.value / m) * 100}%;background:${r.color || "var(--blue)"}"></u></i><em>${r.value}</em></div>`).join("")}</div>`;
};

/* ============ toasts, notifications, modal ============ */
const NOTES = []; let unread = 0;
function toast(msg, type = "ok") {
  const t = document.createElement("div");
  t.className = `toast ${type}`; t.textContent = msg;
  $("#toasts").append(t); setTimeout(() => t.remove(), 4500);
  NOTES.unshift({ msg, type, at: new Date() }); if (NOTES.length > 15) NOTES.pop();
  unread++; const b = $("#bellN"); b.textContent = unread; b.hidden = false;
}
function modal(html) { const m = $("#modal"); m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><button class="x" data-act="close" aria-label="Close">×</button>${html}</div>`; m.hidden = false; }
function closeModal() { const m = $("#modal"); m.hidden = true; m.innerHTML = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("#bell").addEventListener("click", () => {
  const n = $("#notes");
  n.innerHTML = NOTES.length ? NOTES.map((x) => `<div class="${x.type}">${esc(x.msg)}<br><small>${x.at.toLocaleTimeString()}</small></div>`).join("") : "<div>No notifications yet.</div>";
  n.hidden = !n.hidden; unread = 0; $("#bellN").hidden = true;
});
$("#burger").addEventListener("click", () => $("#side").classList.toggle("open"));

/* ============ shared views ============ */
const stepper = (e) => {
  const idx = FLOW.findIndex((f) => f[0] === e.status);
  const at = Object.fromEntries((e.log || []).map((l) => [l.status, l.at]));
  return `<ol class="steps">${FLOW.map((f, i) => {
    const cls = e.status === "CANCELLED" ? (at[f[0]] ? "done" : "") : e.status === "COMPLETED" || i < idx ? "done" : i === idx ? "cur" : "";
    return `<li class="${cls}"><i></i><span>${f[1]}</span><small>${at[f[0]] ? new Date(at[f[0]]).toLocaleTimeString() : ""}</small></li>`;
  }).join("")}</ol>${e.status === "CANCELLED" ? '<p class="note">This request was cancelled.</p>' : ""}`;
};
const detail = (e) => {
  const kv = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`;
  return `<div class="kv">${kv("Status", stB(e.status, EMGST))}${kv("Category", esc(e.category))}${kv("Patient", esc(e.patient) + demoTag(e.demo))}${kv("Patients", e.patients)}
${kv("Pickup", `${L(e.pickup_node)} · ${esc(e.pickup_name)}`)}${kv("Contact", esc(e.phone) || "—")}${kv("Created", fdt(e.created_at))}${kv("Description", esc(e.description))}
${kv("Ambulance", e.ambulance_id ? `${esc(e.ambulance_id)} · ${esc(e.ambulance_name)}` : "Not assigned")}${kv("Hospital", e.hospital_id ? esc(e.hospital_name) : "Not selected yet")}
${kv("Route to patient", e.pickup_path ? `${pstr(e.pickup_path)}<br><span class="mute">${km(e.pickup_km)} · ${mins(e.pickup_min)}</span>` : "—")}
${kv("Route to hospital", e.hospital_path ? `${pstr(e.hospital_path)}<br><span class="mute">${km(e.hospital_km)} · ${mins(e.hospital_min)}</span>` : "—")}
${kv("Dispatched", fdt(e.dispatched_at))}${kv("Completed", fdt(e.completed_at))}</div>${stepper(e)}`;
};
const missionMap = (e, ambs = [], emgs = []) =>
  drawMap(S.nodes, S.edges, { routes: [{ path: e?.pickup_path, cls: "r1" }, { path: e?.hospital_path, cls: "r2" }], ambs, emgs }) + legend();

/* ============ dashboard ============ */
async function pgDash() {
  const d = await api.get("/dashboard"), k = d.kpis;
  const kp = (l, v, c = "") => `<div class="card kpi ${c}"><small>${l}</small><b>${v}</b></div>`;
  const pr = Object.entries(SEV).map(([s, x]) => ({ label: `${s} ${x[0]}`, value: d.priority[s] || 0, color: x[1] }));
  const fl = Object.entries(d.fleet).map(([s, n]) => ({ label: s.replace(/_/g, " "), value: n, color: CSSCOL[AMBST[s]] }));
  const re = d.recent_emergencies.length ? `<table class="tbl"><tbody>${d.recent_emergencies.map((e) => `<tr><td><b>${e.id}</b></td><td>${esc(e.patient)}</td><td>${sevB(e.severity)}</td><td>${stB(e.status, EMGST)}</td></tr>`).join("")}</tbody></table>` : empty("No emergency requests", "Create one from Emergency Requests.");
  const rd = d.recent_dispatches.length ? `<table class="tbl"><tbody>${d.recent_dispatches.map((x) => `<tr><td><b>${x.emergency_id}</b></td><td>${x.ambulance_id}</td><td>${km(x.pickup_km)} · ${mins(x.pickup_min)}</td><td><small>${fdt(x.dispatched_at)}</small></td></tr>`).join("")}</tbody></table>` : empty("No dispatches yet", "Dispatch a pending request to see activity.");
  return `${d.demo ? banner() : ""}
<div class="grid k4">${kp("Total requests", k.total)}${kp("Critical (open)", k.critical, "red")}${kp("Active dispatches", k.active, "blue")}${kp("Available ambulances", k.available, "green")}
${kp("Busy ambulances", k.busy, "amber")}${kp("Completed missions", k.completed)}${kp("Avg response (simulated)", k.avg_response_min == null ? "—" : k.avg_response_min + " min")}${kp("Pending dispatch", k.pending, "amber")}</div>
<div class="grid g21"><div class="card"><div class="ch"><h3>Road network</h3><a class="btn sm" href="#/dispatch">Open dispatch center</a></div>${drawMap(S.nodes, S.edges, { ambs: d.ambulances.map((a) => ({ node: a.node, id: a.id, status: a.status })), emgs: d.open_emergencies.map((e) => ({ node: e.node, severity: e.severity })), km: false })}${legend()}</div>
<div><div class="card" style="margin-bottom:14px"><h3 style="margin-bottom:12px">Priority distribution</h3>${bars(pr)}</div><div class="card"><h3 style="margin-bottom:12px">Fleet status</h3>${bars(fl)}</div></div></div>
<div class="grid g2"><div class="card scroll"><h3 style="margin-bottom:8px">Recent emergency requests</h3>${re}</div><div class="card scroll"><h3 style="margin-bottom:8px">Recent dispatch activity</h3>${rd}</div></div>`;
}

/* ============ emergencies ============ */
const FILT = { emg: { q: "", status: "", severity: "", sort: "priority" }, amb: { q: "", status: "" }, hos: { q: "", facility: "" }, his: { q: "" }, an: { from: "", to: "" } };
const emgActs = (e) => {
  const b = (a, l, c = "") => `<button class="btn sm ${c}" data-act="${a}" data-id="${e.id}">${l}</button>`;
  let h = b("view", "View");
  if (e.status === "PENDING") h += b("edit", "Edit") + b("dispatch", "Dispatch", "primary");
  else if (!TERM.includes(e.status)) h += b("advance", "Next step", "primary");
  if (!TERM.includes(e.status)) h += b("cancel", "Cancel", "danger");
  return h;
};
const emgRows = (l) => l.length ? l.map((e) => `<tr><td><b>${e.id}</b>${demoTag(e.demo)}</td><td>${esc(e.patient)}</td><td>${esc(e.category)}</td><td>${sevB(e.severity)}</td><td>${L(e.pickup_node)} · ${esc(e.pickup_name)}</td><td>${stB(e.status, EMGST)}</td><td>${fdt(e.created_at)}</td><td><div class="acts">${emgActs(e)}</div></td></tr>`).join("") : `<tr><td colspan="8">${empty("No emergencies match", "Change the filters or create a new request.")}</td></tr>`;
async function pgEmg() {
  const r = await api.get("/emergencies", FILT.emg), F = FILT.emg;
  return `<div class="bar-tools"><input data-filter="emg.q" placeholder="Search ID, patient, category…" value="${esc(F.q)}" aria-label="Search">
<select data-filter="emg.status" aria-label="Status">${opts([["", "All statuses"], ["ACTIVE", "Active (in progress)"], ...["PENDING", "DISPATCHED", "EN_ROUTE", "AT_PATIENT", "PICKED_UP", "HOSPITAL_SELECTED", "TRANSPORTING", "COMPLETED", "CANCELLED"].map((s) => [s, s.replace(/_/g, " ")])], F.status)}</select>
<select data-filter="emg.severity" aria-label="Severity">${opts([["", "All severities"], ...Object.entries(SEV).map(([k, x]) => [k, `${k} – ${x[0]}`])], F.severity)}</select>
<select data-filter="emg.sort" aria-label="Sort">${opts([["priority", "Sort: priority (P1 first, FIFO)"], ["newest", "Sort: newest first"], ["oldest", "Sort: oldest first"]], F.sort)}</select>
<button class="btn primary" data-act="new">New emergency</button></div>
<div class="card scroll"><table class="tbl"><thead><tr><th>ID</th><th>Patient</th><th>Category</th><th>Priority</th><th>Pickup</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody id="emgBody">${emgRows(r.items)}</tbody></table></div>`;
}
function emgForm(e) {
  const v = e || { severity: "P3", category: "Medical Emergency", patients: 1, pickup_node: S.nodes[0]?.id };
  modal(`<h2>${e ? `Edit ${e.id}` : "New emergency request"}</h2>
<form data-form="emg" data-id="${e?.id || ""}" class="form">
${field("Patient name or ID", `<input name="patient" required minlength="2" maxlength="80" value="${esc(v.patient)}">`)}
<div class="row2">${field("Category", `<select name="category">${opts(CATS.map((c) => [c, c]), v.category)}</select>`)}${field("Severity", `<select name="severity">${opts(Object.entries(SEV).map(([k, x]) => [k, `${k} – ${x[0]}`]), v.severity)}</select>`)}</div>
<div class="row2">${field("Pickup location", `<select name="pickup_node">${opts(nodeOpts(), v.pickup_node)}</select>`)}${field("Patients", `<input name="patients" type="number" min="1" max="10" value="${v.patients}">`)}</div>
${field("Contact number (optional)", `<input name="phone" inputmode="tel" pattern="[0-9+\\-\\s()]{7,20}" title="7–20 digits, spaces, + - ( )" value="${esc(v.phone)}">`)}
${field("Description", `<textarea name="description" required minlength="3" maxlength="500" rows="3">${esc(v.description)}</textarea>`)}
<small>Request ID and timestamp are generated automatically.</small>
<div class="actions"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">${e ? "Save changes" : "Create request"}</button></div></form>`);
}

/* ============ fleet ============ */
const ambCards = (l) => l.length ? l.map((a) => `<div class="card"><div class="amb-h"><div><b>${esc(a.name)}</b>${demoTag(a.demo)}<small>${a.id} · ${a.type}</small></div>${stB(a.status, AMBST)}</div>
<div class="kv2"><span>Location</span><b>${L(a.node)} · ${esc(S.by[a.node]?.name)}</b><span>Capacity</span><b>${a.capacity} patient(s)</b><span>Available</span><b>${a.status === "AVAILABLE" ? "Now" : a.status === "OUT_OF_SERVICE" ? "Out of service" : a.available_at ? "≈ " + new Date(a.available_at).toLocaleTimeString() : "—"}</b></div>
<div class="chips">${a.equipment.map((x) => `<span>${x.replace("_", " ")}</span>`).join("") || "<span>basic kit</span>"}</div>
<div class="acts"><button class="btn sm" data-act="ambedit" data-id="${a.id}">Edit</button><button class="btn sm danger" data-act="ambdel" data-id="${a.id}">Remove</button></div></div>`).join("") : empty("No ambulances match", "Adjust the filters or add a unit.");
async function pgFleet() {
  const r = await api.get("/ambulances", FILT.amb), s = r.summary, F = FILT.amb;
  const kp = (l, v, c = "") => `<div class="card kpi ${c}"><small>${l}</small><b>${v}</b></div>`;
  return `<div class="grid k4">${kp("Total fleet", s.total)}${kp("Available", s.available, "green")}${kp("Busy", s.busy, "amber")}${kp("Utilization", s.utilization_pct + "%", "blue")}</div>
<div class="bar-tools"><input data-filter="amb.q" placeholder="Search name, ID, type, equipment…" value="${esc(F.q)}" aria-label="Search">
<select data-filter="amb.status" aria-label="Status">${opts([["", "All statuses"], ...Object.keys(AMBST).map((x) => [x, x.replace(/_/g, " ")])], F.status)}</select>
<button class="btn primary" data-act="ambnew">Add ambulance</button></div>
<div class="grid g3" id="ambGrid">${ambCards(r.items)}</div>`;
}
function ambForm(a) {
  const v = a || { type: "BLS", capacity: 2, equipment: ["oxygen"], status: "AVAILABLE", node: S.nodes[0]?.id }, busy = a && BUSY.includes(a.status), dis = busy ? "disabled" : "";
  modal(`<h2>${a ? `Edit ${a.id}` : "Add ambulance"}</h2><form data-form="amb" data-id="${a?.id || ""}" class="form">
${field("Vehicle name", `<input name="name" required minlength="2" maxlength="60" value="${esc(v.name)}">`)}
<div class="row2">${field("Type", `<select name="type" ${dis}>${opts([["BLS", "BLS – basic"], ["ALS", "ALS – advanced"], ["ICU", "ICU – mobile ICU"]], v.type)}</select>`)}${field("Capacity", `<input name="capacity" type="number" min="1" max="10" value="${v.capacity}">`)}</div>
<div class="row2">${field("Current location", `<select name="node" ${dis}>${opts(nodeOpts(), v.node)}</select>`)}${field("Status", `<select name="status" ${dis}>${opts([["AVAILABLE", "AVAILABLE"], ["OUT_OF_SERVICE", "OUT OF SERVICE"]], v.status)}</select>`)}</div>
<fieldset class="chk"><legend>Equipment</legend>${EQUIP.map((x) => `<label><input type="checkbox" name="eq" value="${x}" ${v.equipment.includes(x) ? "checked" : ""}> ${x.replace("_", " ")}</label>`).join("")}</fieldset>
${busy ? '<p class="note">This unit is on a mission, so type, location and status are locked.</p>' : ""}
<div class="actions"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">${a ? "Save changes" : "Add ambulance"}</button></div></form>`);
}

/* ============ routes ============ */
const RT = { ambs: [], hos: [], res: null, pick: { 1: -1, 2: -1 } };
async function pgRoutes() {
  const [a, h] = await Promise.all([api.get("/ambulances"), api.get("/hospitals")]);
  RT.ambs = a.items; RT.hos = h.items;
  return `<div class="card" style="margin-bottom:14px"><form data-form="route" class="inline">
${field("Emergency location", `<select name="pickup">${opts(nodeOpts(), RT.res?.pk ?? 8)}</select>`)}
${field("Ambulance", `<select name="amb">${opts(RT.ambs.map((x) => [x.id, `${x.id} · ${x.name} @ ${L(x.node)}${x.status !== "AVAILABLE" ? " (" + x.status.replace(/_/g, " ").toLowerCase() + ")" : ""}`]), RT.res?.amb.id)}</select>`)}
${field("Destination hospital", `<select name="hos">${opts(RT.hos.map((x) => [x.id, x.name]), RT.res?.hos.id)}</select>`)}
<button class="btn primary">Calculate route</button></form>
<small>Routes are computed by Dijkstra's algorithm in the C engine on the weighted road graph.</small></div><div id="routeOut">${RT.res ? routeHtml() : empty("No route calculated yet", "Choose a location, ambulance and hospital, then calculate.")}</div>`;
}
const legRoute = (leg) => { const r = RT.res, i = RT.pick[leg], base = leg === 1 ? r.l1 : r.l2, alts = (leg === 1 ? r.a1 : r.a2).alternatives; return i < 0 ? base : alts[i]; };
const routeMap = () => { const r = RT.res; return drawMap(S.nodes, S.edges, { routes: [{ path: legRoute(1).path, cls: "r1" }, { path: legRoute(2).path, cls: "r2" }], ambs: [{ node: r.amb.node, id: r.amb.id, status: r.amb.status }], emgs: [{ node: r.pk, severity: "P1" }] }) + legend(); };
function altTable(leg, title) {
  const r = RT.res, base = leg === 1 ? r.l1 : r.l2, alts = (leg === 1 ? r.a1 : r.a2).alternatives;
  const row = (x, i, label) => `<tr class="${RT.pick[leg] === i ? "sel" : ""}"><td>${label}</td><td>${pstr(x.path)}</td><td>${km(x.distance_km)}${i >= 0 ? ` <small>(+${(x.distance_km - base.distance_km).toFixed(1)})</small>` : ""}</td><td>${mins(x.minutes)}</td><td><button class="btn sm" data-act="alt" data-leg="${leg}" data-i="${i}">${RT.pick[leg] === i ? "Showing" : "Show on map"}</button></td></tr>`;
  return `<h3 style="margin:14px 0 6px">${title}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Route</th><th>Path</th><th>Distance</th><th>Time</th><th></th></tr></thead><tbody>${row(base, -1, "Shortest")}${alts.map((x, i) => row(x, i, `Alternate ${i + 1}`)).join("") || '<tr><td colspan="5"><small>No alternate path found.</small></td></tr>'}</tbody></table></div>`;
}
function routeHtml() {
  const r = RT.res;
  if (r.l1.status !== "OK" || r.l2.status !== "OK") return `<div class="card errp"><h3>No route found</h3><p>One of the legs is unreachable on the current road graph.</p></div>`;
  const a = legRoute(1), b = legRoute(2), full = [...a.path, ...b.path.slice(1)];
  const info = (k, v) => `<div class="card"><small>${k}</small><div class="path" style="margin:4px 0 0;font-size:15px">${v}</div></div>`;
  return `<div class="grid g3">${info("Ambulance", `${esc(r.amb.id)} · ${esc(r.amb.name)}<br><small>Starts at ${L(r.amb.node)} · ${esc(S.by[r.amb.node]?.name)}</small>`)}${info("Pickup", `${L(r.pk)} · ${esc(S.by[r.pk]?.name)}`)}${info("Hospital", `${esc(r.hos.name)}<br><small>Node ${L(r.hos.node)}</small>`)}</div>
<div class="card" style="margin-bottom:14px"><small>Shortest route (ambulance → patient → hospital)</small><div class="path">${pstr(full)}</div>
<div class="grid k4" style="margin:0"><div><small>Total distance</small><br><b style="font-size:22px">${km(a.distance_km + b.distance_km)}</b></div><div><small>Estimated travel time</small><br><b style="font-size:22px">${mins(a.minutes + b.minutes)}</b></div><div><small>To patient</small><br><b>${km(a.distance_km)} · ${mins(a.minutes)}</b></div><div><small>To hospital</small><br><b>${km(b.distance_km)} · ${mins(b.minutes)}</b></div></div></div>
<div class="card" style="margin-bottom:14px"><div id="routeMap">${routeMap()}</div></div>
<div class="card">${altTable(1, "Ambulance → patient")}${altTable(2, "Patient → hospital")}</div>`;
}

/* ============ hospitals ============ */
const HR = { pickup: 8, category: "Cardiac Emergency", severity: "P1", html: "" };
const hosCards = (l) => l.length ? l.map((h) => `<div class="card"><div class="amb-h"><div><b>${esc(h.name)}</b>${demoTag(h.demo)}<small>${h.id} · ${esc(h.type)}</small></div>${h.beds_available > 0 ? '<span class="badge green">ACCEPTING</span>' : '<span class="badge red">FULL</span>'}</div>
<div class="kv2"><span>Location</span><b>${L(h.node)} · ${esc(S.by[h.node]?.name)}</b><span>Beds free</span><b>${h.beds_available} / ${h.capacity}</b></div>
<div class="chips">${h.facilities.map((x) => `<span>${x}</span>`).join("")}</div><div class="acts"><button class="btn sm" data-act="hosedit" data-id="${h.id}">Edit</button></div></div>`).join("") : empty("No hospitals match", "Adjust the filters or add a hospital.");
async function pgHos() {
  const r = await api.get("/hospitals", FILT.hos), F = FILT.hos;
  return `<div class="card" style="margin-bottom:14px"><h3 style="margin-bottom:10px">Find a suitable hospital</h3><form data-form="rec" class="inline">
${field("Pickup location", `<select name="pickup">${opts(nodeOpts(), HR.pickup)}</select>`)}${field("Emergency type", `<select name="category">${opts(CATS.map((c) => [c, c]), HR.category)}</select>`)}
${field("Severity", `<select name="severity">${opts(Object.entries(SEV).map(([k, x]) => [k, `${k} – ${x[0]}`]), HR.severity)}</select>`)}<button class="btn primary">Recommend</button></form><div id="recOut">${HR.html}</div></div>
<div class="bar-tools"><input data-filter="hos.q" placeholder="Search hospitals…" value="${esc(F.q)}" aria-label="Search"><select data-filter="hos.facility" aria-label="Facility">${opts([["", "All facilities"], ...FAC.map((x) => [x, x])], F.facility)}</select><button class="btn primary" data-act="hosnew">Add hospital</button></div>
<div class="grid g3" id="hosGrid">${hosCards(r.items)}</div>`;
}
function hosForm(h) {
  const v = h || { facilities: ["emergency"], capacity: 20, beds_available: 5, node: S.nodes[0]?.id };
  modal(`<h2>${h ? `Edit ${h.id}` : "Add hospital"}</h2><form data-form="hos" data-id="${h?.id || ""}" class="form">
${field("Hospital name", `<input name="name" required minlength="2" maxlength="80" value="${esc(v.name)}">`)}
<div class="row2">${field("Hospital type", `<input name="type" required minlength="2" maxlength="80" value="${esc(v.type || "General")}">`)}${field("Location", `<select name="node">${opts(nodeOpts(), v.node)}</select>`)}</div>
<div class="row2">${field("Capacity (beds)", `<input name="capacity" type="number" min="1" max="1000" value="${v.capacity}">`)}${field("Beds available", `<input name="beds_available" type="number" min="0" max="1000" value="${v.beds_available}">`)}</div>
<fieldset class="chk"><legend>Facilities</legend>${FAC.map((x) => `<label><input type="checkbox" name="fac" value="${x}" ${v.facilities.includes(x) ? "checked" : ""}> ${x}</label>`).join("")}</fieldset>
<div class="actions"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">${h ? "Save changes" : "Add hospital"}</button></div></form>`);
}

/* ============ dispatch center ============ */
let SEL = null;
async function pgDispatch() {
  const [p, a, amb] = await Promise.all([api.get("/emergencies", { status: "PENDING", sort: "priority" }), api.get("/emergencies", { status: "ACTIVE", sort: "oldest" }), api.get("/ambulances")]);
  const act = a.items; if (!act.find((e) => e.id === SEL)) SEL = act[0]?.id || null;
  const cur = act.find((e) => e.id === SEL);
  const q = p.items.map((e, i) => `<div class="qi"><div><b>#${i + 1} ${e.id}</b> ${sevB(e.severity)}<small>${esc(e.patient)} · ${esc(e.category)}<br>${L(e.pickup_node)} · ${esc(e.pickup_name)}</small></div><button class="btn sm primary" data-act="dispatch" data-id="${e.id}">Dispatch</button></div>`).join("") || empty("Queue is empty", "New requests appear here in priority order.");
  const am = act.map((e) => `<div class="qi ${e.id === SEL ? "sel" : ""}" data-act="sel" data-id="${e.id}"><div><b>${e.id}</b> ${sevB(e.severity)}<small>${esc(e.ambulance_id)} · ${e.status.replace(/_/g, " ")}</small></div></div>`).join("") || empty("No active missions");
  return `<div class="dsp"><div class="card"><div class="ch"><h3>Dispatch queue</h3><button class="btn sm" data-act="auto">Auto-dispatch all</button></div>${q}<h3 class="mt" style="margin-bottom:10px">Active missions</h3>${am}</div>
<div class="card"><div class="ch"><h3>Route map</h3><span class="pill">${cur ? cur.id : "no mission selected"}</span></div>${missionMap(cur, amb.items.map((x) => ({ node: x.node, id: x.id, status: x.status })), [...p.items, ...act].map((e) => ({ node: e.pickup_node, severity: e.severity })))}<p class="mute small">Progress is simulated step by step. No real GPS tracking.</p></div>
<div class="card">${cur ? `<h3>${cur.id} ${sevB(cur.severity)}</h3>${detail(cur)}<div class="actions"><button class="btn danger" data-act="cancel" data-id="${cur.id}">Cancel</button><button class="btn primary" data-act="advance" data-id="${cur.id}">Advance to: ${nextLabel(cur)}</button></div>` : empty("Select a mission", "Dispatch a pending request to track it here.")}</div></div>`;
}

/* ============ history ============ */
const hisRows = (l) => l.length ? l.map((e) => `<tr><td><b>${e.id}</b>${demoTag(e.demo)}</td><td>${esc(e.patient)}</td><td>${sevB(e.severity)}</td><td>${esc(e.ambulance_id) || "—"}</td><td>${esc(e.hospital_name) || "—"}</td><td>${e.pickup_km != null ? km((e.pickup_km || 0) + (e.hospital_km || 0)) : "—"}</td><td>${mins(e.pickup_min)}</td><td>${stB(e.status, EMGST)}</td><td>${fdt(e.completed_at || e.log?.at(-1)?.at)}</td><td><button class="btn sm" data-act="view" data-id="${e.id}">View</button></td></tr>`).join("") : `<tr><td colspan="10">${empty("No history yet", "Completed and cancelled requests are listed here.")}</td></tr>`;
async function pgHist() {
  const r = await api.get("/history", FILT.his);
  return `<div class="bar-tools"><input data-filter="his.q" placeholder="Search ID, patient, category…" value="${esc(FILT.his.q)}" aria-label="Search"></div>
<div class="card scroll"><table class="tbl"><thead><tr><th>ID</th><th>Patient</th><th>Priority</th><th>Ambulance</th><th>Hospital</th><th>Distance</th><th>Response</th><th>Outcome</th><th>Closed</th><th></th></tr></thead><tbody id="hisBody">${hisRows(r.items)}</tbody></table></div>`;
}

/* ============ analytics ============ */
const anBody = (a) => {
  const t = a.totals, kp = (l, v, c = "") => `<div class="card kpi ${c}"><small>${l}</small><b>${v}</b></div>`, m = Math.max(1, ...a.daily_dispatches.map((d) => d.count));
  return `${a.demo ? banner() : ""}<div class="grid k4">${kp("Total requests", t.total)}${kp("Completed", t.completed, "green")}${kp("Pending", t.pending, "amber")}${kp("Cancelled", t.cancelled)}
${kp("Avg response (simulated)", a.avg_response_min == null ? "—" : a.avg_response_min + " min", "blue")}${kp("Fleet utilization (now)", a.utilization_pct + "%")}${kp("Distance travelled", a.distance_km + " km")}${kp("Dispatches", t.dispatches)}</div>
<div class="grid g2"><div class="card"><h3 style="margin-bottom:12px">Priority-wise requests</h3>${bars(Object.entries(SEV).map(([s, x]) => ({ label: `${s} ${x[0]}`, value: a.by_priority[s], color: x[1] })))}</div>
<div class="card"><h3 style="margin-bottom:12px">Hospital usage</h3>${bars(a.hospital_usage.map((h) => ({ label: h.name, value: h.count })))}</div></div>
<div class="card"><h3 style="margin-bottom:12px">Dispatch activity by day</h3>${a.daily_dispatches.length ? `<div class="cols">${a.daily_dispatches.map((d) => `<div><em style="font-style:normal">${d.count}</em><u style="height:${(d.count / m) * 100}%"></u><small>${d.day.slice(5)}</small></div>`).join("")}</div>` : empty("No dispatches in this range")}</div>`;
};
async function pgAn() {
  const a = await api.get("/analytics", FILT.an), F = FILT.an;
  return `<div class="bar-tools">${field("From", `<input type="date" data-filter="an.from" value="${esc(F.from)}">`)}${field("To", `<input type="date" data-filter="an.to" value="${esc(F.to)}">`)}<button class="btn" data-act="anclear">Clear dates</button></div><div id="anBody">${anBody(a)}</div>`;
}

/* ============ settings ============ */
async function pgSet() {
  const s = await api.get("/settings"), c = s.counts, docs = API_BASE.replace(/\/api$/, "") + "/docs";
  const kv = (k, v) => `<span>${k}</span><b>${v}</b>`;
  return `<div class="grid g2"><div class="card"><h3>System information</h3><div class="kv2">${kv("Version", s.version)}${kv("Database", s.database)}${kv("C routing engine", s.engine ? '<span class="badge green">OK</span>' : '<span class="badge red">MISSING</span>')}${kv("Road nodes / roads", `${c.nodes} / ${c.roads}`)}${kv("Emergencies", c.emergencies)}${kv("Ambulances / hospitals", `${c.ambulances} / ${c.hospitals}`)}${kv("API", `<code>${esc(API_BASE)}</code>`)}${kv("API docs", `<a href="${esc(docs)}" target="_blank" rel="noopener">Swagger UI</a>`)}</div></div>
<div class="card"><h3>Routing parameter</h3><p class="mute">Average ambulance speed used to turn kilometres into estimated minutes.</p><form data-form="speed" class="inline">${field("Speed (km/h)", `<input name="speed" type="number" min="5" max="120" step="1" value="${s.speed_kmh}" required>`)}<button class="btn primary">Save speed</button></form></div>
<div class="card"><h3>Demo data</h3><p class="mute">Restores the sample ambulances, hospitals and emergencies. All dispatch history and records you created are removed.</p><button class="btn danger" data-act="reset">Reset demo data</button></div>
<div class="card"><h3>About ResQRoute</h3><p class="mute">Academic simulation of emergency ambulance dispatch. Dijkstra, min-heap and priority queue run in C; FastAPI connects them to a SQLite database and this web interface. The map is simulated and no real GPS is used.</p><p>Developed by <b>Harsh Pande</b> · Frontend hosted on Netlify</p></div></div>`;
}

/* ============ actions ============ */
const refresh = () => render(true);
const ACT = {
  close: closeModal,
  retry: () => render(),
  new: () => emgForm(),
  view: async (id) => { const e = await api.get(`/emergencies/${id}`); modal(`<h2>${e.id} ${sevB(e.severity)}</h2>${detail(e)}<div class="mapbox">${missionMap(e)}</div>`); },
  edit: async (id) => emgForm(await api.get(`/emergencies/${id}`)),
  dispatch: async (id) => { const e = await api.post(`/emergencies/${id}/dispatch`); toast(`${e.id} dispatched: ${e.ambulance_id}, ${km(e.pickup_km)}, about ${mins(e.pickup_min)}`); await refresh(); },
  advance: async (id) => { const e = await api.post(`/emergencies/${id}/advance-status`); toast(`${e.id} is now ${e.status.replace(/_/g, " ")}`); await refresh(); },
  cancel: async (id) => { if (!confirm(`Cancel ${id}?`)) return; await api.del(`/emergencies/${id}`); toast(`${id} cancelled`, "warn"); await refresh(); },
  sel: async (id) => { SEL = id; await refresh(); },
  auto: async () => { const r = await api.post("/dispatch/auto"); toast(`${r.dispatched.length} dispatched, ${r.unassigned.length} still waiting`, r.unassigned.length ? "warn" : "ok"); if (r.unassigned[0]) toast(`${r.unassigned[0].id}: ${r.unassigned[0].reason}`, "warn"); await refresh(); },
  ambnew: () => ambForm(),
  ambedit: async (id) => ambForm(await api.get(`/ambulances/${id}`)),
  ambdel: async (id) => { if (!confirm(`Remove ${id}?`)) return; await api.del(`/ambulances/${id}`); toast(`${id} removed`, "warn"); await refresh(); },
  hosnew: () => hosForm(),
  hosedit: async (id) => hosForm((await api.get("/hospitals")).items.find((h) => h.id === id)),
  alt: (_, t) => { RT.pick[t.dataset.leg] = Number(t.dataset.i); $("#routeOut").innerHTML = routeHtml(); },
  anclear: async () => { FILT.an = { from: "", to: "" }; await refresh(); },
  reset: async () => { if (!confirm("Reset all data to the demo set? Your own records will be deleted.")) return; await api.post("/demo/reset"); RT.res = null; SEL = null; HR.html = ""; toast("Demo data restored"); await refresh(); },
};
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]"); if (!t || t.disabled || !ACT[t.dataset.act]) return;
  t.disabled = true;
  try { await ACT[t.dataset.act](t.dataset.id, t); } catch (err) { toast(err.message, "error"); } finally { t.disabled = false; }
});

const FORMS = {
  async emg(f) {
    const d = Object.fromEntries(new FormData(f));
    const body = { patient: d.patient, category: d.category, severity: d.severity, pickup_node: +d.pickup_node, patients: +d.patients, phone: d.phone.trim() || null, description: d.description };
    const id = f.dataset.id, r = id ? await api.patch(`/emergencies/${id}`, body) : await api.post("/emergencies", body);
    closeModal(); toast(id ? `${r.id} updated` : `${r.id} created (${r.severity})`); await refresh();
  },
  async amb(f) {
    const fd = new FormData(f), id = f.dataset.id, body = { name: fd.get("name"), capacity: +fd.get("capacity"), equipment: fd.getAll("eq") };
    if (fd.has("node")) Object.assign(body, { node: +fd.get("node"), type: fd.get("type"), status: fd.get("status") });
    const r = id ? await api.patch(`/ambulances/${id}`, body) : await api.post("/ambulances", body);
    closeModal(); toast(id ? `${r.id} updated` : `${r.id} added`); await refresh();
  },
  async hos(f) {
    const fd = new FormData(f), id = f.dataset.id;
    const body = { name: fd.get("name"), type: fd.get("type"), node: +fd.get("node"), capacity: +fd.get("capacity"), beds_available: +fd.get("beds_available"), facilities: fd.getAll("fac") };
    if (!body.facilities.length) throw new Error("Select at least one facility");
    const r = id ? await api.patch(`/hospitals/${id}`, body) : await api.post("/hospitals", body);
    closeModal(); toast(id ? `${r.id} updated` : `${r.id} added`); await refresh();
  },
  async speed(f) { await api.patch("/settings", { speed_kmh: +new FormData(f).get("speed") }); toast("Speed saved. New routes use it."); await refresh(); },
  async route(f) {
    const d = Object.fromEntries(new FormData(f)), amb = RT.ambs.find((a) => a.id === d.amb), hos = RT.hos.find((h) => h.id === d.hos), pk = +d.pickup;
    const [l1, l2, a1, a2] = await Promise.all([api.get("/routes/calculate", { src: amb.node, dst: pk }), api.get("/routes/calculate", { src: pk, dst: hos.node }), api.get("/routes/alternatives", { src: amb.node, dst: pk }), api.get("/routes/alternatives", { src: pk, dst: hos.node })]);
    RT.res = { amb, hos, pk, l1, l2, a1, a2 }; RT.pick = { 1: -1, 2: -1 }; $("#routeOut").innerHTML = routeHtml();
  },
  async rec(f) {
    const d = Object.fromEntries(new FormData(f)); Object.assign(HR, { pickup: +d.pickup, category: d.category, severity: d.severity });
    const r = await api.get("/hospitals", { pickup: HR.pickup, category: HR.category, severity: HR.severity });
    const reach = r.items.filter((h) => h.distance_km != null), near = reach.length ? Math.min(...reach.map((h) => h.distance_km)) : null;
    HR.html = `<p class="mute">Needs: <b>${r.required.join(", ")}</b> and a free bed.${r.fallback ? ' <span class="note">No hospital meets every need, so the nearest with an emergency unit is suggested.</span>' : ""}</p>
<div class="scroll"><table class="tbl"><thead><tr><th>Hospital</th><th>Distance</th><th>Time</th><th>Beds</th><th>Result</th></tr></thead><tbody>${r.items.map((h) => `<tr><td><b>${esc(h.name)}</b><br><small>${h.facilities.join(", ")}</small></td><td>${km(h.distance_km)}${h.distance_km === near ? ' <span class="badge blue">NEAREST</span>' : ""}</td><td>${mins(h.minutes)}</td><td>${h.beds_available}/${h.capacity}</td><td>${h.recommended ? '<span class="badge green">RECOMMENDED</span>' : h.distance_km == null ? '<span class="badge grey">UNREACHABLE</span>' : !h.has_beds ? '<span class="badge red">NO BEDS</span>' : !h.meets_requirements ? `<span class="badge amber">LACKS ${h.missing.join(", ").toUpperCase()}</span>` : '<span class="badge grey">FARTHER</span>'}</td></tr>`).join("")}</tbody></table></div>`;
    $("#recOut").innerHTML = HR.html;
  },
};
document.addEventListener("submit", async (e) => {
  const f = e.target.closest("form[data-form]"); if (!f) return;
  e.preventDefault(); if (f.dataset.busy) return; f.dataset.busy = "1";
  const btns = [...f.querySelectorAll("button:not([type=button])")]; btns.forEach((b) => (b.disabled = true));
  try { await FORMS[f.dataset.form](f); } catch (err) { toast(err.message, "error"); } finally { delete f.dataset.busy; btns.forEach((b) => (b.disabled = false)); }
});

/* live filters: server-side, debounced */
const RELOAD = {
  emg: async () => { $("#emgBody").innerHTML = emgRows((await api.get("/emergencies", FILT.emg)).items); },
  amb: async () => { $("#ambGrid").innerHTML = ambCards((await api.get("/ambulances", FILT.amb)).items); },
  hos: async () => { $("#hosGrid").innerHTML = hosCards((await api.get("/hospitals", FILT.hos)).items); },
  his: async () => { $("#hisBody").innerHTML = hisRows((await api.get("/history", FILT.his)).items); },
  an: async () => { $("#anBody").innerHTML = anBody(await api.get("/analytics", FILT.an)); },
};
let tmr;
document.addEventListener("input", (e) => {
  const k = e.target.dataset?.filter; if (!k) return;
  const [sc, key] = k.split("."); FILT[sc][key] = e.target.value;
  clearTimeout(tmr); tmr = setTimeout(() => RELOAD[sc]().catch((er) => toast(er.message, "error")), 250);
});

/* ============ router, connection status ============ */
const ICON = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  emergencies: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  fleet: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>',
  routes: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
  hospitals: '<path d="M3 21V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v16zM12 8v6M9 11h6"/>',
  dispatch: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
};
const PAGES = {
  dashboard: ["Dashboard", pgDash], emergencies: ["Emergency Requests", pgEmg], fleet: ["Ambulance Fleet", pgFleet], routes: ["Route Optimization", pgRoutes],
  hospitals: ["Hospital Directory", pgHos], dispatch: ["Dispatch Center", pgDispatch], history: ["Emergency History", pgHist], analytics: ["Analytics & Reports", pgAn], settings: ["Settings & System", pgSet],
};
function setConn(s, extra = "") { const c = $("#conn"); c.className = `pill conn ${s}`; c.lastElementChild.textContent = { online: "Connected", connecting: "Connecting", offline: "Offline" }[s] + extra; }
async function ping() { try { const h = await api.get("/health"); setConn("online", h.engine ? "" : " · engine missing"); } catch { setConn("offline"); } }
async function ensureMap() {
  if (S.nodes.length) return;
  const m = await api.get("/map"); S.nodes = m.nodes; S.edges = m.edges; S.by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
}
const errPanel = (e) => `<div class="card errp"><h2>${e.status === 0 ? "Backend offline" : "Something went wrong"}</h2><p>${esc(e.message)}</p><p class="mute small">API: <code>${esc(API_BASE)}</code></p><button class="btn primary" data-act="retry">Try again</button></div>`;
let tok = 0;
async function render(soft = false) {
  const key = location.hash.replace(/^#\//, "") || "dashboard", [title, fn] = PAGES[key] || PAGES.dashboard, my = ++tok;
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (PAGES[key] ? key : "dashboard")));
  $("#title").textContent = title; document.title = `${title} · ResQRoute`;
  if (!soft) $("#view").innerHTML = '<div class="skel"></div><div class="skel"></div>';
  try {
    await ensureMap();
    const html = await fn();
    if (my !== tok) return;
    $("#view").innerHTML = html; setConn("online");
  } catch (err) {
    if (my !== tok) return;
    if (soft) toast(err.message, "error"); else $("#view").innerHTML = errPanel(err);
    if (err.status === 0) setConn("offline");
  }
}
$("#nav").innerHTML = Object.entries(PAGES).map(([k, [t]]) => `<a href="#/${k}" data-nav="${k}"><svg class="i" viewBox="0 0 24 24">${ICON[k]}</svg><span>${t}</span></a>`).join("");
window.addEventListener("hashchange", () => { $("#side").classList.remove("open"); $("#notes").hidden = true; render(); });
setInterval(ping, 15000);
render(); ping();
