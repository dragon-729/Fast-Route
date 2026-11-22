"""Bridge to the C DSA engine (c_engine/build/resq_engine). Python only formats input / parses JSON."""
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

DEFAULT_BIN = Path(__file__).resolve().parents[2] / "c_engine" / "build" / "resq_engine"


class EngineError(RuntimeError):
    pass


@dataclass
class Graph:
    n: int
    edges: list
    speed: float = 40.0

    def text(self):
        return "\n".join([f"{self.n} {len(self.edges)} {self.speed}"] + [f"{u} {v} {w}" for u, v, w in self.edges]) + "\n"


def load_graph(conn):
    n = conn.execute("SELECT COUNT(*) FROM road_nodes").fetchone()[0]
    edges = [(r["u"], r["v"], r["km"]) for r in conn.execute("SELECT u,v,km FROM road_edges")]
    row = conn.execute("SELECT value FROM system_settings WHERE key='speed_kmh'").fetchone()
    return Graph(n, edges, float(row[0]) if row else 40.0)


def _run(text):
    exe = os.getenv("ENGINE_BIN") or str(DEFAULT_BIN)
    try:
        p = subprocess.run([exe], input=text, capture_output=True, text=True, timeout=5)
    except FileNotFoundError:
        raise EngineError("C engine binary not found - run `make` inside c_engine/")
    except subprocess.TimeoutExpired:
        raise EngineError("C engine timed out")
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        raise EngineError("C engine returned invalid output")


def route(g, s, d):
    return _run(g.text() + f"ROUTE {s} {d}\n")


def assign(g, dest, nodes):
    """Lowest-cost candidate node to `dest` (used for ambulances and hospitals)."""
    return _run(g.text() + f"ASSIGN {dest} {len(nodes)} " + " ".join(map(str, nodes)) + "\n")


def alternatives(g, s, d):
    return _run(g.text() + f"ALT {s} {d}\n")


def order(priorities, seqs):
    """Indices ordered by C min-heap: priority 1..4, then FIFO by seq."""
    if not priorities:
        return []
    body = "".join(f"{p} {s}\n" for p, s in zip(priorities, seqs))
    res = _run(f"1 0 40\nPQ {len(priorities)}\n{body}")
    if res.get("status") != "OK":
        raise EngineError(res.get("error", "priority queue failed"))
    return res["order"]


def ping():
    try:
        return _run("2 1 40\n0 1 1\nROUTE 0 1\n").get("status") == "OK"
    except EngineError:
        return False
