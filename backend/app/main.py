"""ResQRoute REST API (FastAPI). Routing / ambulance selection / priority ordering are done by the C engine."""
import json
import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints

from . import db, engine
from .db import AMB_STATUS, EMG_STATUS

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("resqroute")

CATEGORIES = ("Medical Emergency", "Accident", "Cardiac Emergency", "Trauma", "Fire-related Medical Emergency", "Other")
FLOW = ["PENDING", "DISPATCHED", "EN_ROUTE", "AT_PATIENT", "PICKED_UP", "HOSPITAL_SELECTED", "TRANSPORTING", "COMPLETED"]
TERMINAL = ("COMPLETED", "CANCELLED")
ACTIVE = tuple(FLOW[1:-1])
BUSY_AMB = ("ASSIGNED", "EN_ROUTE", "AT_PATIENT", "TRANSPORTING", "RETURNING")
AMB_FOR = {"DISPATCHED": "ASSIGNED", "EN_ROUTE": "EN_ROUTE", "AT_PATIENT": "AT_PATIENT", "PICKED_UP": "AT_PATIENT",
           "HOSPITAL_SELECTED": "AT_PATIENT", "TRANSPORTING": "TRANSPORTING", "COMPLETED": "AVAILABLE"}
NEED_EQUIP = {"Cardiac Emergency": {"defibrillator"}, "Trauma": {"trauma_kit"}, "Accident": {"trauma_kit"},
              "Fire-related Medical Emergency": {"oxygen"}}
NEED_FACILITY = {"Cardiac Emergency": "cardiology", "Trauma": "trauma", "Accident": "trauma",
                 "Fire-related Medical Emergency": "burn"}
Equip = Literal["oxygen", "defibrillator", "cardiac_monitor", "ventilator", "trauma_kit"]
Facility = Literal["emergency", "trauma", "cardiology", "icu", "burn", "general"]
Category = Literal["Medical Emergency", "Accident", "Cardiac Emergency", "Trauma", "Fire-related Medical Emergency", "Other"]
Severity = Literal["P1", "P2", "P3", "P4"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]


@asynccontextmanager
async def lifespan(_):
    db.init_db()
    log.info("Database ready at %s", db.db_path())
    yield


app = FastAPI(title="ResQRoute API", version="1.0.0", lifespan=lifespan,
              description="Emergency ambulance dispatch simulation. Developed by Harsh Pande.")
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX") or None,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type"])


@app.exception_handler(engine.EngineError)
async def _engine_err(_, exc):
    log.error("engine: %s", exc)
    return JSONResponse({"detail": f"Routing engine unavailable: {exc}"}, status_code=503)


@app.exception_handler(RequestValidationError)
async def _val_err(_, exc):
    errs = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse({"detail": "Validation failed: " + "; ".join(f"{e['field']}: {e['message']}" for e in errs), "errors": errs}, status_code=422)


@app.exception_handler(Exception)
async def _any_err(_, exc):
    log.exception("unhandled error")
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


def get_db():
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


DB = Annotated[sqlite3.Connection, Depends(get_db)]


# ---------------- schemas ----------------
class EmergencyIn(BaseModel):
    patient: Name
    category: Category
    severity: Severity
    pickup_node: int = Field(ge=0)
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]
    phone: Optional[str] = Field(default=None, pattern=r"^[0-9+\-\s()]{7,20}$")
    patients: int = Field(default=1, ge=1, le=10)


class EmergencyPatch(BaseModel):
    patient: Optional[Name] = None
    category: Optional[Category] = None
    severity: Optional[Severity] = None
    pickup_node: Optional[int] = Field(default=None, ge=0)
    description: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]] = None
    phone: Optional[str] = Field(default=None, pattern=r"^[0-9+\-\s()]{7,20}$")
    patients: Optional[int] = Field(default=None, ge=1, le=10)


class AmbulanceIn(BaseModel):
    name: Name
    type: Literal["BLS", "ALS", "ICU"]
    node: int = Field(ge=0)
    capacity: int = Field(ge=1, le=10)
    equipment: list[Equip] = []
    status: Literal["AVAILABLE", "OUT_OF_SERVICE"] = "AVAILABLE"


class AmbulancePatch(BaseModel):
    name: Optional[Name] = None
    type: Optional[Literal["BLS", "ALS", "ICU"]] = None
    node: Optional[int] = Field(default=None, ge=0)
    capacity: Optional[int] = Field(default=None, ge=1, le=10)
    equipment: Optional[list[Equip]] = None
    status: Optional[Literal["AVAILABLE", "OUT_OF_SERVICE"]] = None


class HospitalIn(BaseModel):
    name: Name
    node: int = Field(ge=0)
    type: Name
    facilities: list[Facility] = ["emergency"]
    capacity: int = Field(ge=1, le=1000)
    beds_available: int = Field(ge=0, le=1000)


class HospitalPatch(BaseModel):
    name: Optional[Name] = None
    node: Optional[int] = Field(default=None, ge=0)
    type: Optional[Name] = None
    facilities: Optional[list[Facility]] = None
    capacity: Optional[int] = Field(default=None, ge=1, le=1000)
    beds_available: Optional[int] = Field(default=None, ge=0, le=1000)


class SettingsPatch(BaseModel):
    speed_kmh: float = Field(ge=5, le=120)


# ---------------- helpers ----------------
def check_node(conn, n):
    if not conn.execute("SELECT 1 FROM road_nodes WHERE id=?", (n,)).fetchone():
        raise HTTPException(422, f"Unknown road node {n}")


def csv(items):
    return ",".join(sorted(set(items)))


def amb_dict(r):
    d = dict(r)
    d["equipment"] = [x for x in d["equipment"].split(",") if x]
    d["demo"] = bool(d["demo"])
    return d


def hos_dict(r):
    d = dict(r)
    d["facilities"] = [x for x in d["facilities"].split(",") if x]
    d["demo"] = bool(d["demo"])
    return d


EMG_SQL = """SELECT e.*, d.ambulance_id, d.hospital_id, d.pickup_path, d.pickup_km, d.pickup_min,
 d.hospital_path, d.hospital_km, d.hospital_min, d.dispatched_at, d.completed_at,
 n.name AS pickup_name, a.name AS ambulance_name, h.name AS hospital_name
 FROM emergencies e LEFT JOIN dispatches d ON d.emergency_id=e.id
 LEFT JOIN road_nodes n ON n.id=e.pickup_node LEFT JOIN ambulances a ON a.id=d.ambulance_id
 LEFT JOIN hospitals h ON h.id=d.hospital_id"""


def emg_dict(r):
    d = dict(r)
    for k in ("pickup_path", "hospital_path"):
        d[k] = json.loads(d[k]) if d[k] else None
    d["log"] = json.loads(d["log"])
    d["demo"] = bool(d["demo"])
    return d


def fetch_emg(conn, eid):
    r = conn.execute(EMG_SQL + " WHERE e.id=?", (eid,)).fetchone()
    if not r:
        raise HTTPException(404, f"Emergency {eid} not found")
    return emg_dict(r)


def set_status(conn, e, status):
    t = db.now()
    conn.execute("UPDATE emergencies SET status=?, log=?, updated_at=? WHERE id=?",
                 (status, json.dumps(e["log"] + [{"status": status, "at": t}]), t, e["id"]))


def route_out(src, dst, r):
    return {"src": src, "dst": dst, "status": r["status"], "distance_km": r.get("distance"),
            "minutes": r.get("minutes"), "path": r.get("path", [])}


def do_dispatch(conn, g, e):
    """Select the lowest-cost eligible ambulance via the C engine. Returns an error string or None."""
    need = NEED_EQUIP.get(e["category"], set())
    elig = [a for a in map(amb_dict, conn.execute("SELECT * FROM ambulances WHERE status='AVAILABLE' AND capacity>=?", (e["patients"],)))
            if need <= set(a["equipment"]) and (e["severity"] != "P1" or a["type"] in ("ALS", "ICU"))]
    if not elig:
        req = ["available", f"capacity >= {e['patients']}"] + sorted(need) + (["ALS/ICU type (P1)"] if e["severity"] == "P1" else [])
        return "No suitable ambulance is available (needs: " + ", ".join(req) + "). The request stays PENDING; dispatch again when a unit is free."
    res = engine.assign(g, e["pickup_node"], [a["node"] for a in elig])
    if res.get("status") != "OK":
        return "No eligible ambulance can reach the pickup location. The request stays PENDING."
    amb, r, t = elig[res["index"]], res["route"], db.now()
    conn.execute("INSERT INTO dispatches(emergency_id,ambulance_id,pickup_path,pickup_km,pickup_min,dispatched_at) VALUES(?,?,?,?,?,?)",
                 (e["id"], amb["id"], json.dumps(r["path"]), r["distance"], r["minutes"], t))
    eta = (datetime.fromisoformat(t.replace("Z", "+00:00")) + timedelta(minutes=r["minutes"])).isoformat(timespec="seconds").replace("+00:00", "Z")
    conn.execute("UPDATE ambulances SET status='ASSIGNED', available_at=? WHERE id=?", (eta, amb["id"]))
    set_status(conn, e, "DISPATCHED")
    return None


def hospital_options(conn, g, pickup, category, severity):
    need = {NEED_FACILITY.get(category, "emergency")} | ({"icu"} if severity == "P1" else set())
    out = []
    for h in map(hos_dict, conn.execute("SELECT * FROM hospitals ORDER BY id")):
        r = engine.route(g, pickup, h["node"])
        ok = r["status"] == "OK"
        h.update(distance_km=r["distance"] if ok else None, minutes=r["minutes"] if ok else None,
                 meets_requirements=need <= set(h["facilities"]), has_beds=h["beds_available"] > 0, recommended=False,
                 missing=sorted(need - set(h["facilities"])))
        out.append(h)
    cands = [h for h in out if h["distance_km"] is not None and h["has_beds"] and h["meets_requirements"]]
    fallback = False
    if not cands:
        cands = [h for h in out if h["distance_km"] is not None and h["has_beds"] and "emergency" in h["facilities"]]
        fallback = True
    best = route = None
    if cands:
        res = engine.assign(g, pickup, [h["node"] for h in cands])
        if res.get("status") == "OK":
            best, route = cands[res["index"]], dict(res["route"])
            route["path"] = route["path"][::-1]   # engine returns candidate->pickup; the hospital leg runs pickup->hospital
            best["recommended"] = True
    return out, best, route, fallback, sorted(need)


# ---------------- system ----------------
@app.get("/api/health")
def health(conn: DB):
    conn.execute("SELECT 1")
    return {"status": "ok", "db": "ok", "engine": engine.ping(), "time": db.now()}


@app.get("/api/map")
def road_map(conn: DB):
    return {"simulated": True,
            "nodes": [dict(r) for r in conn.execute("SELECT id,name,kind,x,y FROM road_nodes ORDER BY id")],
            "edges": [dict(r) for r in conn.execute("SELECT u,v,km FROM road_edges ORDER BY id")]}


@app.get("/api/settings")
def get_settings(conn: DB):
    g = engine.load_graph(conn)
    c = lambda t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    return {"speed_kmh": g.speed, "version": app.version, "engine": engine.ping(), "database": "SQLite",
            "counts": {"nodes": g.n, "roads": len(g.edges), "emergencies": c("emergencies"), "ambulances": c("ambulances"), "hospitals": c("hospitals")}}


@app.patch("/api/settings")
def patch_settings(body: SettingsPatch, conn: DB):
    conn.execute("INSERT OR REPLACE INTO system_settings VALUES('speed_kmh',?)", (str(body.speed_kmh),))
    conn.commit()
    return get_settings(conn)


@app.post("/api/demo/reset")
def demo_reset(conn: DB):
    db.reset_demo(conn)
    return {"status": "reset", "message": "Demo data restored"}


# ---------------- emergencies ----------------
@app.get("/api/emergencies")
def list_emg(conn: DB, q: str = "", status: str = "", severity: str = "",
             sort: Literal["priority", "newest", "oldest"] = "newest"):
    where, args = [], []
    if q:
        where.append("(e.id LIKE ? OR e.patient LIKE ? OR e.description LIKE ? OR e.category LIKE ?)")
        args += [f"%{q}%"] * 4
    if status == "ACTIVE":
        where.append("e.status IN (" + ",".join("?" * len(ACTIVE)) + ")")
        args += list(ACTIVE)
    elif status:
        where.append("e.status=?")
        args.append(status)
    if severity:
        where.append("e.severity=?")
        args.append(severity)
    sql = EMG_SQL + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY e.seq"
    rows = [emg_dict(r) for r in conn.execute(sql, args)]
    if sort == "priority" and rows:   # C min-heap: P1 > P2 > P3 > P4, FIFO inside a priority
        rows = [rows[i] for i in engine.order([int(r["severity"][1]) for r in rows], [r["seq"] for r in rows])]
    elif sort == "newest":
        rows.reverse()
    return {"items": rows, "count": len(rows)}


@app.post("/api/emergencies", status_code=201)
def create_emg(body: EmergencyIn, conn: DB):
    check_node(conn, body.pickup_node)
    eid = db.insert_emergency(conn, body.model_dump())
    conn.commit()
    return fetch_emg(conn, eid)


@app.get("/api/emergencies/{eid}")
def get_emg(eid: str, conn: DB):
    return fetch_emg(conn, eid)


@app.patch("/api/emergencies/{eid}")
def patch_emg(eid: str, body: EmergencyPatch, conn: DB):
    e = fetch_emg(conn, eid)
    if e["status"] != "PENDING":
        raise HTTPException(409, "Only PENDING emergencies can be edited")
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k == "phone"}
    if "pickup_node" in data:
        check_node(conn, data["pickup_node"])
    if data:
        conn.execute("UPDATE emergencies SET " + ",".join(f"{k}=?" for k in data) + ", updated_at=? WHERE id=?",
                     (*data.values(), db.now(), eid))
        conn.commit()
    return fetch_emg(conn, eid)


@app.delete("/api/emergencies/{eid}")
def cancel_emg(eid: str, conn: DB):
    e = fetch_emg(conn, eid)
    if e["status"] in TERMINAL:
        raise HTTPException(409, f"Emergency is already {e['status']}")
    if e["ambulance_id"]:
        conn.execute("UPDATE ambulances SET status='AVAILABLE', available_at=NULL WHERE id=?", (e["ambulance_id"],))
    if e["hospital_id"]:
        conn.execute("UPDATE hospitals SET beds_available=MIN(capacity, beds_available+1) WHERE id=?", (e["hospital_id"],))
    set_status(conn, e, "CANCELLED")
    conn.commit()
    return fetch_emg(conn, eid)


@app.post("/api/emergencies/{eid}/dispatch")
def dispatch_one(eid: str, conn: DB):
    e = fetch_emg(conn, eid)
    if e["status"] != "PENDING":
        raise HTTPException(409, f"Emergency is {e['status']}, only PENDING requests can be dispatched")
    err = do_dispatch(conn, engine.load_graph(conn), e)
    if err:
        raise HTTPException(409, err)
    conn.commit()
    return fetch_emg(conn, eid)


@app.post("/api/dispatch/auto")
def dispatch_auto(conn: DB):
    """Dispatch every PENDING request in priority order (C priority queue) - also used to retry after units free up."""
    rows = [emg_dict(r) for r in conn.execute(EMG_SQL + " WHERE e.status='PENDING' ORDER BY e.seq")]
    rows = [rows[i] for i in engine.order([int(r["severity"][1]) for r in rows], [r["seq"] for r in rows])]
    g, done, waiting = engine.load_graph(conn), [], []
    for e in rows:
        err = do_dispatch(conn, g, e)
        (waiting.append({"id": e["id"], "reason": err}) if err else done.append(e["id"]))
    conn.commit()
    return {"dispatched": done, "unassigned": waiting}


@app.post("/api/emergencies/{eid}/advance-status")
def advance(eid: str, conn: DB):
    e = fetch_emg(conn, eid)
    if e["status"] == "PENDING":
        raise HTTPException(409, "Dispatch this emergency first")
    if e["status"] in TERMINAL:
        raise HTTPException(409, f"Emergency is already {e['status']}")
    nxt, amb_id, t = FLOW[FLOW.index(e["status"]) + 1], e["ambulance_id"], db.now()
    if nxt == "HOSPITAL_SELECTED":
        g = engine.load_graph(conn)
        _, best, route, fallback, _ = hospital_options(conn, g, e["pickup_node"], e["category"], e["severity"])
        if not best:
            raise HTTPException(409, "No reachable hospital with free beds. Try again later.")
        conn.execute("UPDATE dispatches SET hospital_id=?, hospital_path=?, hospital_km=?, hospital_min=? WHERE emergency_id=?",
                     (best["id"], json.dumps(route["path"]), route["distance"], route["minutes"], eid))
        conn.execute("UPDATE hospitals SET beds_available=beds_available-1 WHERE id=? AND beds_available>0", (best["id"],))
    if nxt == "AT_PATIENT":
        conn.execute("UPDATE ambulances SET node=? WHERE id=?", (e["pickup_node"], amb_id))
    if nxt == "COMPLETED":
        node = conn.execute("SELECT node FROM hospitals WHERE id=?", (e["hospital_id"],)).fetchone()[0]
        conn.execute("UPDATE ambulances SET node=?, available_at=NULL WHERE id=?", (node, amb_id))
        conn.execute("UPDATE dispatches SET completed_at=? WHERE emergency_id=?", (t, eid))
    conn.execute("UPDATE ambulances SET status=? WHERE id=?", (AMB_FOR[nxt], amb_id))
    set_status(conn, e, nxt)
    conn.commit()
    return fetch_emg(conn, eid)


# ---------------- ambulances ----------------
@app.get("/api/ambulances")
def list_amb(conn: DB, q: str = "", status: str = ""):
    allr = [amb_dict(r) for r in conn.execute("SELECT * FROM ambulances ORDER BY id")]
    items = [a for a in allr if (not status or a["status"] == status) and
             (not q or q.lower() in f"{a['id']} {a['name']} {a['type']} {' '.join(a['equipment'])}".lower())]
    busy = sum(a["status"] in BUSY_AMB for a in allr)
    oos = sum(a["status"] == "OUT_OF_SERVICE" for a in allr)
    inservice = len(allr) - oos
    return {"items": items, "count": len(items),
            "summary": {"total": len(allr), "available": sum(a["status"] == "AVAILABLE" for a in allr), "busy": busy,
                        "out_of_service": oos, "utilization_pct": round(busy / inservice * 100) if inservice else 0}}


@app.get("/api/ambulances/{aid}")
def get_amb(aid: str, conn: DB):
    r = conn.execute("SELECT * FROM ambulances WHERE id=?", (aid,)).fetchone()
    if not r:
        raise HTTPException(404, f"Ambulance {aid} not found")
    return amb_dict(r)


@app.post("/api/ambulances", status_code=201)
def add_amb(body: AmbulanceIn, conn: DB):
    check_node(conn, body.node)
    nums = [int(r[0][4:]) for r in conn.execute("SELECT id FROM ambulances") if r[0][4:].isdigit()]
    aid = f"AMB-{max(nums, default=0) + 1:02d}"
    conn.execute("INSERT INTO ambulances(id,name,type,node,capacity,equipment,status) VALUES(?,?,?,?,?,?,?)",
                 (aid, body.name, body.type, body.node, body.capacity, csv(body.equipment), body.status))
    conn.commit()
    return get_amb(aid, conn)


@app.patch("/api/ambulances/{aid}")
def patch_amb(aid: str, body: AmbulancePatch, conn: DB):
    a = get_amb(aid, conn)
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if a["status"] in BUSY_AMB and {"node", "status", "type"} & data.keys():
        raise HTTPException(409, "Unit is on a mission: type, location and status can't be changed")
    if "node" in data:
        check_node(conn, data["node"])
    if "equipment" in data:
        data["equipment"] = csv(data["equipment"])
    if data:
        if data.get("status") == "OUT_OF_SERVICE":
            data["available_at"] = None
        conn.execute("UPDATE ambulances SET " + ",".join(f"{k}=?" for k in data) + " WHERE id=?", (*data.values(), aid))
        conn.commit()
    return get_amb(aid, conn)


@app.delete("/api/ambulances/{aid}")
def del_amb(aid: str, conn: DB):
    a = get_amb(aid, conn)
    if a["status"] in BUSY_AMB:
        raise HTTPException(409, "Unit is on a mission and can't be removed")
    try:
        conn.execute("DELETE FROM ambulances WHERE id=?", (aid,))
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Unit has dispatch history - set it OUT_OF_SERVICE instead of removing it")
    return {"deleted": aid}


# ---------------- hospitals ----------------
@app.get("/api/hospitals")
def list_hos(conn: DB, q: str = "", facility: str = "", pickup: Optional[int] = Query(default=None, ge=0),
             category: Category = "Other", severity: Severity = "P3"):
    out = [hos_dict(r) for r in conn.execute("SELECT * FROM hospitals ORDER BY id")]
    extra = {"recommended": None, "fallback": False, "required": []}
    if pickup is not None:
        check_node(conn, pickup)
        out, best, _, fb, need = hospital_options(conn, engine.load_graph(conn), pickup, category, severity)
        extra = {"recommended": best["id"] if best else None, "fallback": fb and best is not None, "required": need}
    out = [h for h in out if (not facility or facility in h["facilities"]) and
           (not q or q.lower() in f"{h['id']} {h['name']} {h['type']}".lower())]
    return {"items": out, "count": len(out), **extra}


@app.post("/api/hospitals", status_code=201)
def add_hos(body: HospitalIn, conn: DB):
    check_node(conn, body.node)
    if body.beds_available > body.capacity:
        raise HTTPException(422, "beds_available can't exceed capacity")
    nums = [int(r[0][4:]) for r in conn.execute("SELECT id FROM hospitals") if r[0][4:].isdigit()]
    hid = f"HOS-{max(nums, default=0) + 1:02d}"
    conn.execute("INSERT INTO hospitals(id,name,node,type,facilities,capacity,beds_available) VALUES(?,?,?,?,?,?,?)",
                 (hid, body.name, body.node, body.type, csv(body.facilities), body.capacity, body.beds_available))
    conn.commit()
    return hos_dict(conn.execute("SELECT * FROM hospitals WHERE id=?", (hid,)).fetchone())


@app.patch("/api/hospitals/{hid}")
def patch_hos(hid: str, body: HospitalPatch, conn: DB):
    r = conn.execute("SELECT * FROM hospitals WHERE id=?", (hid,)).fetchone()
    if not r:
        raise HTTPException(404, f"Hospital {hid} not found")
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "node" in data:
        check_node(conn, data["node"])
    if "facilities" in data:
        data["facilities"] = csv(data["facilities"])
    if data.get("beds_available", r["beds_available"]) > data.get("capacity", r["capacity"]):
        raise HTTPException(422, "beds_available can't exceed capacity")
    if data:
        conn.execute("UPDATE hospitals SET " + ",".join(f"{k}=?" for k in data) + " WHERE id=?", (*data.values(), hid))
        conn.commit()
    return hos_dict(conn.execute("SELECT * FROM hospitals WHERE id=?", (hid,)).fetchone())


# ---------------- routes ----------------
@app.get("/api/routes/calculate")
def calc_route(conn: DB, src: int = Query(ge=0), dst: int = Query(ge=0)):
    check_node(conn, src)
    check_node(conn, dst)
    return route_out(src, dst, engine.route(engine.load_graph(conn), src, dst))


@app.get("/api/routes/alternatives")
def alt_routes(conn: DB, src: int = Query(ge=0), dst: int = Query(ge=0)):
    check_node(conn, src)
    check_node(conn, dst)
    res = engine.alternatives(engine.load_graph(conn), src, dst)
    return {"primary": route_out(src, dst, res["primary"]) if res.get("primary") else None,
            "alternatives": [route_out(src, dst, r) for r in res["routes"]]}


# ---------------- dashboard / analytics / history ----------------
def _counts(conn, sql, args=()):
    return {r[0]: r[1] for r in conn.execute(sql, args)}


@app.get("/api/dashboard")
def dashboard(conn: DB):
    st = _counts(conn, "SELECT status, COUNT(*) FROM emergencies GROUP BY status")
    amb = _counts(conn, "SELECT status, COUNT(*) FROM ambulances GROUP BY status")
    sev = _counts(conn, "SELECT severity, COUNT(*) FROM emergencies WHERE status<>'CANCELLED' GROUP BY severity")
    open_ = ("PENDING",) + ACTIVE
    avg = conn.execute("SELECT AVG(pickup_min) FROM dispatches").fetchone()[0]
    demo = conn.execute("SELECT (SELECT COUNT(*) FROM emergencies WHERE demo=1)+(SELECT COUNT(*) FROM ambulances WHERE demo=1)").fetchone()[0] > 0
    recent_d = conn.execute("""SELECT d.emergency_id, d.ambulance_id, d.pickup_km, d.pickup_min, d.dispatched_at, e.patient, e.severity, e.status
        FROM dispatches d JOIN emergencies e ON e.id=d.emergency_id ORDER BY d.id DESC LIMIT 6""").fetchall()
    return {
        "demo": demo,
        "kpis": {"total": sum(st.values()), "critical": conn.execute("SELECT COUNT(*) FROM emergencies WHERE severity='P1' AND status IN (%s)" % ",".join("?" * len(open_)), open_).fetchone()[0],
                 "active": sum(st.get(s, 0) for s in ACTIVE), "pending": st.get("PENDING", 0), "completed": st.get("COMPLETED", 0),
                 "cancelled": st.get("CANCELLED", 0), "available": amb.get("AVAILABLE", 0),
                 "busy": sum(amb.get(s, 0) for s in BUSY_AMB), "avg_response_min": round(avg, 1) if avg is not None else None},
        "priority": {s: sev.get(s, 0) for s in ("P1", "P2", "P3", "P4")},
        "fleet": {s: amb.get(s, 0) for s in AMB_STATUS},
        "recent_emergencies": list_emg(conn, sort="newest")["items"][:6],
        "recent_dispatches": [dict(r) for r in recent_d],
        "ambulances": [{"id": r["id"], "node": r["node"], "status": r["status"]} for r in conn.execute("SELECT id,node,status FROM ambulances")],
        "open_emergencies": [{"id": r["id"], "node": r["pickup_node"], "severity": r["severity"]} for r in
                             conn.execute("SELECT id,pickup_node,severity FROM emergencies WHERE status IN (%s)" % ",".join("?" * len(open_)), open_)],
    }


@app.get("/api/analytics")
def analytics(conn: DB, date_from: Optional[str] = Query(default=None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
              date_to: Optional[str] = Query(default=None, alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$")):
    where, args = "WHERE 1=1", []
    if date_from:
        where += " AND substr(e.created_at,1,10) >= ?"
        args.append(date_from)
    if date_to:
        where += " AND substr(e.created_at,1,10) <= ?"
        args.append(date_to)
    st = _counts(conn, f"SELECT e.status, COUNT(*) FROM emergencies e {where} GROUP BY e.status", args)
    sev = _counts(conn, f"SELECT e.severity, COUNT(*) FROM emergencies e {where} GROUP BY e.severity", args)
    base = "FROM dispatches d JOIN emergencies e ON e.id=d.emergency_id"
    j = f"{base} {where}"
    avg, dist, n = conn.execute(f"SELECT AVG(d.pickup_min), SUM(d.pickup_km + COALESCE(d.hospital_km,0)), COUNT(*) {j}", args).fetchone()
    fleet = list_amb(conn)["summary"]
    return {
        "demo": conn.execute("SELECT COUNT(*) FROM emergencies WHERE demo=1").fetchone()[0] > 0,
        "range": {"from": date_from, "to": date_to},
        "totals": {"total": sum(st.values()), "completed": st.get("COMPLETED", 0), "pending": st.get("PENDING", 0),
                   "active": sum(st.get(s, 0) for s in ACTIVE), "cancelled": st.get("CANCELLED", 0), "dispatches": n},
        "avg_response_min": round(avg, 1) if avg is not None else None,
        "distance_km": round(dist, 1) if dist else 0,
        "utilization_pct": fleet["utilization_pct"],
        "by_priority": {s: sev.get(s, 0) for s in ("P1", "P2", "P3", "P4")},
        "hospital_usage": [dict(r) for r in conn.execute(f"SELECT h.name AS name, COUNT(*) AS count {base} JOIN hospitals h ON h.id=d.hospital_id {where} GROUP BY h.id ORDER BY count DESC", args)],
        "daily_dispatches": [{"day": r[0], "count": r[1]} for r in conn.execute(f"SELECT substr(d.dispatched_at,1,10) AS day, COUNT(*) {j} GROUP BY day ORDER BY day", args)],
    }


@app.get("/api/history")
def history(conn: DB, q: str = ""):
    sql = EMG_SQL + " WHERE e.status IN ('COMPLETED','CANCELLED')"
    args = []
    if q:
        sql += " AND (e.id LIKE ? OR e.patient LIKE ? OR e.category LIKE ?)"
        args = [f"%{q}%"] * 3
    rows = [emg_dict(r) for r in conn.execute(sql + " ORDER BY e.updated_at DESC, e.seq DESC", args)]
    return {"items": rows, "count": len(rows)}
