import heapq
import pathlib

import pytest
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[2]
BIN = ROOT / "c_engine" / "build" / "resq_engine"
FLOW = ["DISPATCHED", "EN_ROUTE", "AT_PATIENT", "PICKED_UP", "HOSPITAL_SELECTED", "TRANSPORTING", "COMPLETED"]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("ENGINE_BIN", str(BIN))
    from app.main import app
    with TestClient(app) as c:
        yield c


def new(c, **kw):
    body = dict(patient="Test Patient", category="Medical Emergency", severity="P3", pickup_node=5, description="Test case")
    body.update(kw)
    r = c.post("/api/emergencies", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def km(c, a, b):
    return c.get("/api/routes/calculate", params={"src": a, "dst": b}).json()["distance_km"]


def test_health(client):
    r = client.get("/api/health").json()
    assert r["status"] == "ok" and r["engine"] is True and r["db"] == "ok"


def test_validation(client):
    assert client.post("/api/emergencies", json={}).status_code == 422
    bad = dict(patient="X", category="Medical Emergency", severity="P9", pickup_node=5, description="ok!")
    assert client.post("/api/emergencies", json=bad).status_code == 422
    ok = dict(patient="Valid Name", category="Medical Emergency", severity="P2", pickup_node=999, description="desc")
    r = client.post("/api/emergencies", json=ok)
    assert r.status_code == 422 and "Unknown road node" in r.json()["detail"]
    assert client.get("/api/emergencies/EMG-9999").status_code == 404


def test_priority_order_fifo(client):
    a = new(client, severity="P1", patient="Late P1")
    items = client.get("/api/emergencies", params={"sort": "priority"}).json()["items"]
    sev = [i["severity"] for i in items]
    assert sev == sorted(sev)
    p1 = [i["id"] for i in items if i["severity"] == "P1"]
    assert p1[-1] == a["id"] and len(p1) == 3          # seeded P1s first (FIFO), newest P1 last
    for s in ("P1", "P2", "P3", "P4"):
        seqs = [i["seq"] for i in items if i["severity"] == s]
        assert seqs == sorted(seqs)


def test_route_matches_independent_dijkstra(client):
    m = client.get("/api/map").json()
    adj = {}
    for e in m["edges"]:
        adj.setdefault(e["u"], []).append((e["v"], e["km"]))
        adj.setdefault(e["v"], []).append((e["u"], e["km"]))
    dist, pq = {0: 0}, [(0, 0)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1e9):
            continue
        for v, w in adj[u]:
            if d + w < dist.get(v, 1e9):
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    for dst in (5, 17, 23):
        r = client.get("/api/routes/calculate", params={"src": 0, "dst": dst}).json()
        assert r["status"] == "OK" and r["path"][0] == 0 and r["path"][-1] == dst
        assert abs(r["distance_km"] - dist[dst]) < 1e-6
        steps = sum(next(w for v, w in adj[a] if v == b) for a, b in zip(r["path"], r["path"][1:]))
        assert abs(steps - r["distance_km"]) < 1e-6
    alt = client.get("/api/routes/alternatives", params={"src": 0, "dst": 23}).json()
    assert all(a["distance_km"] >= alt["primary"]["distance_km"] for a in alt["alternatives"])
    assert client.get("/api/routes/calculate", params={"src": 0, "dst": 500}).status_code == 422


def test_dispatch_picks_lowest_cost_ambulance(client):
    e = new(client, pickup_node=5)
    avail = client.get("/api/ambulances", params={"status": "AVAILABLE"}).json()["items"]
    best = min(km(client, a["node"], 5) for a in avail)
    d = client.post(f"/api/emergencies/{e['id']}/dispatch").json()
    assert d["status"] == "DISPATCHED" and abs(d["pickup_km"] - best) < 1e-6
    amb = client.get(f"/api/ambulances/{d['ambulance_id']}").json()
    assert amb["status"] == "ASSIGNED"
    assert client.post(f"/api/emergencies/{e['id']}/dispatch").status_code == 409


def test_p1_cardiac_needs_advanced_unit_with_defibrillator(client):
    e = new(client, category="Cardiac Emergency", severity="P1", pickup_node=8)
    d = client.post(f"/api/emergencies/{e['id']}/dispatch").json()
    a = client.get(f"/api/ambulances/{d['ambulance_id']}").json()
    assert a["type"] in ("ALS", "ICU") and "defibrillator" in a["equipment"]


def test_no_ambulance_keeps_request_pending_then_reassign(client):
    for a in client.get("/api/ambulances").json()["items"]:
        client.patch(f"/api/ambulances/{a['id']}", json={"status": "OUT_OF_SERVICE"})
    e = new(client)
    r = client.post(f"/api/emergencies/{e['id']}/dispatch")
    assert r.status_code == 409 and "No suitable ambulance" in r.json()["detail"]
    assert client.get(f"/api/emergencies/{e['id']}").json()["status"] == "PENDING"
    client.patch("/api/ambulances/AMB-02", json={"status": "AVAILABLE"})
    auto = client.post("/api/dispatch/auto").json()
    assert e["id"] in auto["dispatched"] or any(u["id"] == e["id"] for u in auto["unassigned"])
    assert len(auto["dispatched"]) == 1          # exactly one free unit -> one dispatch


def test_auto_dispatch_serves_priority_first(client):
    for a in client.get("/api/ambulances").json()["items"]:
        if a["id"] != "AMB-01":
            client.patch(f"/api/ambulances/{a['id']}", json={"status": "OUT_OF_SERVICE"})
    low = new(client, severity="P4", pickup_node=0)
    auto = client.post("/api/dispatch/auto").json()
    assert auto["dispatched"] and auto["dispatched"][0] != low["id"]
    first = client.get(f"/api/emergencies/{auto['dispatched'][0]}").json()
    assert first["severity"] == "P1"


def test_full_lifecycle_and_hospital_choice(client):
    e = new(client, category="Cardiac Emergency", severity="P1", pickup_node=8)
    client.post(f"/api/emergencies/{e['id']}/dispatch")
    seen = []
    for _ in FLOW[1:]:
        r = client.post(f"/api/emergencies/{e['id']}/advance-status")
        assert r.status_code == 200, r.text
        seen.append(r.json()["status"])
    assert seen == FLOW[1:]
    done = client.get(f"/api/emergencies/{e['id']}").json()
    assert done["hospital_id"] == "HOS-02" and done["completed_at"] and done["hospital_path"][-1] == 14
    amb = client.get(f"/api/ambulances/{done['ambulance_id']}").json()
    assert amb["status"] == "AVAILABLE" and amb["node"] == 14
    assert client.post(f"/api/emergencies/{e['id']}/advance-status").status_code == 409
    assert client.get("/api/dashboard").json()["kpis"]["completed"] == 1


def test_hospital_recommendation_not_just_nearest(client):
    r = client.get("/api/hospitals", params={"pickup": 3, "category": "Cardiac Emergency", "severity": "P1"}).json()
    near = min(r["items"], key=lambda h: h["distance_km"])
    assert near["id"] == "HOS-04" and r["recommended"] == "HOS-02"
    assert "cardiology" in r["required"]


def test_cancel_edit_rules(client):
    e = new(client)
    assert client.patch(f"/api/emergencies/{e['id']}", json={"severity": "P1"}).json()["severity"] == "P1"
    assert client.delete(f"/api/emergencies/{e['id']}").json()["status"] == "CANCELLED"
    assert client.delete(f"/api/emergencies/{e['id']}").status_code == 409
    assert client.patch(f"/api/emergencies/{e['id']}", json={"severity": "P2"}).status_code == 409


def test_fleet_crud_rules(client):
    r = client.post("/api/ambulances", json={"name": "New Unit", "type": "ALS", "node": 4, "capacity": 2, "equipment": ["oxygen"]})
    assert r.status_code == 201 and r.json()["id"] == "AMB-08"
    assert client.delete("/api/ambulances/AMB-08").status_code == 200
    e = new(client)
    d = client.post(f"/api/emergencies/{e['id']}/dispatch").json()
    assert client.delete(f"/api/ambulances/{d['ambulance_id']}").status_code == 409
    assert client.post("/api/ambulances", json={"name": "Bad", "type": "XYZ", "node": 1, "capacity": 2}).status_code == 422


def test_analytics_and_reset(client):
    e = new(client, pickup_node=5)
    client.post(f"/api/emergencies/{e['id']}/dispatch")
    a = client.get("/api/analytics").json()
    assert a["totals"]["dispatches"] == 1 and a["avg_response_min"] is not None and a["distance_km"] > 0
    assert client.get("/api/analytics", params={"from": "2999-01-01"}).json()["totals"]["total"] == 0
    assert client.post("/api/demo/reset").status_code == 200
    assert client.get("/api/emergencies").json()["count"] == 5


def test_persistence_across_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "p.db"))
    monkeypatch.setenv("ENGINE_BIN", str(BIN))
    from app.main import app
    with TestClient(app) as c1:
        eid = new(c1, patient="Persist Me")["id"]
    with TestClient(app) as c2:
        assert c2.get(f"/api/emergencies/{eid}").json()["patient"] == "Persist Me"
        assert c2.get("/api/emergencies").json()["count"] == 6
