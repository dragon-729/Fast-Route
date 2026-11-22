"""SQLite schema, seed data and helpers. All queries elsewhere are parameterised."""
import json
import math
import os
import sqlite3
from datetime import datetime, timezone

AMB_STATUS = ("AVAILABLE", "ASSIGNED", "EN_ROUTE", "AT_PATIENT", "TRANSPORTING", "RETURNING", "OUT_OF_SERVICE")
EMG_STATUS = ("PENDING", "DISPATCHED", "EN_ROUTE", "AT_PATIENT", "PICKED_UP", "HOSPITAL_SELECTED",
              "TRANSPORTING", "COMPLETED", "CANCELLED")
_q = lambda t: ",".join(f"'{x}'" for x in t)  # constants only, never user input

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS road_nodes(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('junction','landmark','station','hospital')),
  x REAL NOT NULL, y REAL NOT NULL);
CREATE TABLE IF NOT EXISTS road_edges(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  u INTEGER NOT NULL REFERENCES road_nodes(id), v INTEGER NOT NULL REFERENCES road_nodes(id),
  km REAL NOT NULL CHECK(km > 0), CHECK(u <> v), UNIQUE(u, v));
CREATE TABLE IF NOT EXISTS ambulances(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN('BLS','ALS','ICU')),
  node INTEGER NOT NULL REFERENCES road_nodes(id),
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 10),
  equipment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN({_q(AMB_STATUS)})),
  available_at TEXT, demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hospitals(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, node INTEGER NOT NULL REFERENCES road_nodes(id),
  type TEXT NOT NULL, facilities TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL CHECK(capacity >= 1),
  beds_available INTEGER NOT NULL CHECK(beds_available >= 0), demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS emergencies(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, patient TEXT NOT NULL, category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN('P1','P2','P3','P4')),
  pickup_node INTEGER NOT NULL REFERENCES road_nodes(id),
  description TEXT NOT NULL, phone TEXT, patients INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN({_q(EMG_STATUS)})),
  log TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS dispatches(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emergency_id TEXT NOT NULL UNIQUE REFERENCES emergencies(id),
  ambulance_id TEXT NOT NULL REFERENCES ambulances(id),
  hospital_id TEXT REFERENCES hospitals(id),
  pickup_path TEXT NOT NULL, pickup_km REAL NOT NULL, pickup_min REAL NOT NULL,
  hospital_path TEXT, hospital_km REAL, hospital_min REAL,
  dispatched_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS system_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_emg_status ON emergencies(status, severity, seq);
CREATE INDEX IF NOT EXISTS idx_amb_status ON ambulances(status);
CREATE INDEX IF NOT EXISTS idx_disp_amb ON dispatches(ambulance_id);
CREATE INDEX IF NOT EXISTS idx_edges_u ON road_edges(u);
CREATE INDEX IF NOT EXISTS idx_edges_v ON road_edges(v);
"""


def db_path():
    return os.getenv("DB_PATH", "resqroute.db")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def connect():
    c = sqlite3.connect(db_path(), timeout=10, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


# ---- demo road network: 6 x 4 city grid, 24 nodes, some roads removed + diagonals added ----
NODES = [
    ("North Station", "station"), ("Lakeview Rd", "junction"), ("Old Town Square", "landmark"),
    ("Green Park Clinic", "hospital"), ("Tech Park Gate", "junction"), ("Airport Rd", "junction"),
    ("Textile Market", "junction"), ("Central Library", "landmark"), ("Clock Tower", "junction"),
    ("City General", "hospital"), ("University Gate", "landmark"), ("East Bus Depot", "junction"),
    ("Central Station", "station"), ("Mall Junction", "junction"), ("Metro Cardiac", "hospital"),
    ("Stadium Rd", "landmark"), ("Fort Circle", "junction"), ("River Bridge", "junction"),
    ("Court Road", "junction"), ("Harbour Rd", "junction"), ("Old Hospital Rd", "junction"),
    ("Riverside Trauma", "hospital"), ("Sunrise Colony", "junction"), ("South Station", "station"),
]


def xy(i):
    r, c = divmod(i, 6)
    return 60 + c * 150, 70 + r * 130


def grid_edges():
    removed = {(7, 8), (14, 15), (16, 22)}
    out = []
    for i in range(24):
        r, c = divmod(i, 6)
        for j in ([i + 1] if c < 5 else []) + ([i + 6] if r < 3 else []):
            if (i, j) not in removed:
                out.append((i, j))
    return out + [(1, 8), (9, 16), (13, 20)]


def edge_km(i, j):
    (xi, yi), (xj, yj) = xy(i), xy(j)
    return round(math.hypot(xi - xj, yi - yj) / 55 * (0.85 + ((i * 7 + j * 3) % 6) * 0.06), 1)


AMBS = [
    ("AMB-01", "Rapid ALS 1", "ALS", 0, 2, "oxygen,defibrillator,cardiac_monitor,trauma_kit", "AVAILABLE"),
    ("AMB-02", "City BLS 2", "BLS", 0, 2, "oxygen", "AVAILABLE"),
    ("AMB-03", "ICU Mobile 3", "ICU", 12, 3, "oxygen,defibrillator,cardiac_monitor,ventilator,trauma_kit", "AVAILABLE"),
    ("AMB-04", "Rapid ALS 4", "ALS", 12, 2, "oxygen,defibrillator,trauma_kit", "AVAILABLE"),
    ("AMB-05", "South BLS 5", "BLS", 23, 2, "oxygen,trauma_kit", "AVAILABLE"),
    ("AMB-06", "South ALS 6", "ALS", 23, 2, "oxygen,defibrillator,cardiac_monitor", "AVAILABLE"),
    ("AMB-07", "Spare BLS 7", "BLS", 12, 2, "oxygen", "OUT_OF_SERVICE"),
]
HOSPS = [
    ("HOS-01", "City General Hospital", 9, "Multi-specialty", "emergency,trauma,icu,general", 40, 12),
    ("HOS-02", "Metro Cardiac Institute", 14, "Cardiac Specialty", "emergency,cardiology,icu", 30, 8),
    ("HOS-03", "Riverside Trauma Center", 21, "Trauma Center", "emergency,trauma,burn,icu", 35, 10),
    ("HOS-04", "Green Park Clinic", 3, "Community Clinic", "emergency,general", 10, 4),
]
EMGS = [
    ("Anita Sharma", "Cardiac Emergency", "P1", 8, "Chest pain and sweating, history of hypertension"),
    ("Rahul Verma", "Accident", "P2", 19, "Two-wheeler collision, suspected leg fracture"),
    ("Meera Joshi", "Medical Emergency", "P3", 5, "High fever and dizziness since morning"),
    ("Unknown male", "Fire-related Medical Emergency", "P1", 16, "Smoke inhalation from a shop fire"),
    ("Sana Khan", "Other", "P4", 1, "Minor fall, sprained ankle"),
]


def insert_emergency(conn, d, demo=0):
    t = now()
    cur = conn.execute(
        "INSERT INTO emergencies(patient,category,severity,pickup_node,description,phone,patients,log,created_at,updated_at,demo)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (d["patient"], d["category"], d["severity"], d["pickup_node"], d["description"], d.get("phone"),
         d.get("patients", 1), json.dumps([{"status": "PENDING", "at": t}]), t, t, demo))
    eid = f"EMG-{cur.lastrowid:04d}"
    conn.execute("UPDATE emergencies SET id=? WHERE seq=?", (eid, cur.lastrowid))
    return eid


def seed_core(conn):
    for i, (name, kind) in enumerate(NODES):
        x, y = xy(i)
        conn.execute("INSERT INTO road_nodes VALUES(?,?,?,?,?)", (i, name, kind, x, y))
    for i, j in grid_edges():
        conn.execute("INSERT INTO road_edges(u,v,km) VALUES(?,?,?)", (i, j, edge_km(i, j)))


def seed_demo(conn):
    for a in AMBS:
        conn.execute("INSERT INTO ambulances(id,name,type,node,capacity,equipment,status,demo) VALUES(?,?,?,?,?,?,?,1)", a)
    for h in HOSPS:
        conn.execute("INSERT INTO hospitals(id,name,node,type,facilities,capacity,beds_available,demo) VALUES(?,?,?,?,?,?,?,1)", h)
    for p, c, s, n, d in EMGS:
        insert_emergency(conn, dict(patient=p, category=c, severity=s, pickup_node=n, description=d), demo=1)
    conn.execute("INSERT OR REPLACE INTO system_settings VALUES('speed_kmh','40')")


def init_db():
    conn = connect()
    conn.executescript(SCHEMA)
    if not conn.execute("SELECT 1 FROM road_nodes").fetchone():
        seed_core(conn)
        seed_demo(conn)
    conn.commit()
    conn.close()


def reset_demo(conn):
    for t in ("dispatches", "emergencies", "ambulances", "hospitals"):
        conn.execute(f"DELETE FROM {t}")
    conn.execute("DELETE FROM sqlite_sequence WHERE name='emergencies'")
    seed_demo(conn)
    conn.commit()
