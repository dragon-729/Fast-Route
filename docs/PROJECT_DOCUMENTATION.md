# ResQRoute – Project Documentation
Developed by Harsh Pande · Hosting: Netlify (frontend) + Render (backend)

## 1. Problem statement & objectives
Ambulance delay costs lives. Dispatchers must rank emergencies, pick the right vehicle, find the quickest road route and choose a hospital that can actually treat the patient. ResQRoute simulates this end to end and demonstrates data structures and algorithms in a working web system.

## 2. Architecture
Browser (JS) → REST/JSON → FastAPI (Python) → spawns C binary `resq_engine` (stdin graph + command, stdout JSON); FastAPI ↔ SQLite.
- **C**: graph, min-heap, Dijkstra, path reconstruction, nearest-candidate selection, priority ordering, alternate routes.
- **Python**: validation, business rules (equipment/capacity/hospital facilities), database, lifecycle, analytics.
- **JavaScript**: pages, forms, SVG map, notifications, connection status.
- **SQLite**: road_nodes, road_edges, ambulances, hospitals, emergencies, dispatches, system_settings.
- **Netlify** serves the static `dist/` build; `VITE_API_BASE_URL` points it to the backend; a catch-all redirect keeps refreshes from 404-ing.

## 3. DSA explanation
- **Weighted graph (adjacency list)**: nodes are junctions, stations, hospitals; edges are two-way roads weighted in km. Weights matter because the *shortest* road is not the one with the fewest junctions.
- **Dijkstra**: all weights are positive, so greedy settling of the closest unsettled node is optimal. Time O((V+E) log V).
- **Min-heap / priority queue**: gives the next closest node in O(log V). The same heap orders emergencies using key `priority×10⁹ + arrival_seq`, so P1 < P2 < P3 < P4 and equal priorities leave in FIFO order.
- **Path reconstruction**: Dijkstra stores each node's predecessor; the path is walked back from the destination and reversed.
- **Ambulance assignment**: Python filters to eligible units (AVAILABLE, capacity, required equipment, ALS/ICU for P1). The C engine runs one Dijkstra from the pickup node and returns the eligible unit with the lowest route cost. Nothing is random.
- **Hospital recommendation**: hospitals must have the facility for the emergency type (cardiology, trauma, burn; ICU for P1) and a free bed; the lowest-cost one wins, so the nearest hospital is *not* always chosen. If none qualifies, the nearest with an emergency unit is suggested and flagged.
- **Alternate routes**: each road on the best route is blocked in turn and Dijkstra re-run; distinct results are ranked by distance.
- Safety: bounds-checked node indices, rejected NaN/negative weights, heap capacity = edges+1 (no overflow), all memory freed; tests run under ASan/UBSan.

## 4. Lifecycle mapping
Received (priority assigned) → Dispatched (ambulance selected, route calculated, dispatch confirmed) → En route → At patient → Picked up → Hospital selected → Transporting → Completed. Ambulance status follows (ASSIGNED, EN_ROUTE, AT_PATIENT, TRANSPORTING, then AVAILABLE at the hospital node). Progress is advanced by the user; there is no GPS.

## 5. Database
Foreign keys on, CHECK constraints for statuses/severity/weights, indexes on status and edge endpoints, ISO-8601 UTC timestamps. `dispatches` stores the C-computed paths, km and minutes. Demo rows carry `demo=1` and show a DEMO tag.

## 6. Testing (actual results from this build)
- C engine: 25/25 checks pass (graph, edges, Dijkstra, unreachable, invalid nodes, blocked roads, path sum, selection, heap, priority queue) with `-fsanitize=address,undefined`.
- Backend: 14 pytest tests pass (health, validation, FIFO priority order, route vs independent Python Dijkstra, lowest-cost assignment, equipment rules, no-ambulance case, auto-dispatch priority, full lifecycle, hospital choice, cancel/edit rules, fleet rules, analytics, reset, persistence across restart).
- Frontend: production build succeeds; headless-Chromium run of all nine pages plus create → dispatch → six status steps → complete, search, route calculation, hospital recommendation, history; no JavaScript errors; no horizontal overflow at 390 px width.
- Not run here: the Docker image build and the live Netlify/Render deployment.

## 7. Limitations & future scope
Simulated static graph (no live traffic), single-user demo without login, SQLite on one instance, status progression is manual. Future: real map import (OpenStreetMap), live traffic weights (A*), authentication/roles, WebSocket updates, PostgreSQL, multi-patient assignment.

## 8. Viva quick answers
- *Why Dijkstra?* Non-negative road weights, single-source shortest path. *Why weighted?* Roads differ in length. *Why a heap?* O(log V) extract-min instead of O(V) scanning.
- *Why C?* The core DSA is implemented in C as required; Python only formats input and reads results.
