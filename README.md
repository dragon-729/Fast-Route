# ResQRoute – Emergency Ambulance Dispatch & Route Optimization

Developed by **Harsh Pande** · Frontend hosted on **Netlify**

An academic simulation of emergency dispatch: requests are prioritised (P1–P4, FIFO inside a priority), the lowest-cost eligible ambulance is chosen, routes are found with **Dijkstra**, and a suitable hospital is recommended. The road map is a locally rendered SVG labelled **SIMULATED** (no map API, no keys).

| Layer | Tech | Does |
|---|---|---|
| `c_engine/` | C (graph, adjacency list, min-heap, Dijkstra) | All routing, nearest-unit selection, priority-queue ordering |
| `backend/` | FastAPI + SQLite | REST API, validation, dispatch rules, persistence, calls the C binary |
| `frontend/` | HTML/CSS/ES modules | Dashboard UI, forms, SVG map, API client |

## Run locally
```bash
# 1) C engine (tests run under AddressSanitizer + UBSan)
cd c_engine && make && make test

# 2) Backend  -> http://localhost:8000/docs
cd ../backend && pip install -r requirements.txt
uvicorn app.main:app --port 8000
python -m pytest tests            # backend tests

# 3) Frontend -> http://localhost:8080
cd ../frontend && npm run dev     # builds dist/ then serves it
```
The database (`resqroute.db`) is created and seeded with DEMO data on first start.

## Deploy
**Backend (Render, Docker)** – New Web Service from the repo; Dockerfile path `backend/Dockerfile`, build context `.` (or use `render.yaml`). Set `ALLOWED_ORIGINS` to your Netlify URL. Attach a persistent disk at `/data` if data must survive restarts. Health check: `/api/health`.

**Frontend (Netlify)** – Base directory `frontend`, build command `npm run build`, publish directory `dist` (already in `frontend/netlify.toml`, which also adds the SPA fallback). Add environment variable `VITE_API_BASE_URL=https://<your-render-service>.onrender.com/api`, then redeploy. The site loads even if the backend is down and shows an **Offline** indicator.

## Demo flow
1. Dashboard → see DEMO data. 2. Emergency Requests → new P1 cardiac request. 3. Dispatch Center → *Dispatch* (nearest ALS/ICU unit with a defibrillator is chosen) → *Advance* through the lifecycle. 4. Route Optimization → compare shortest vs alternate routes. 5. Hospital Directory → recommendation skips the nearest clinic when it lacks cardiology. 6. Analytics / History. 7. Settings → reset demo data.

More detail (DSA explanation, viva questions, limits): `docs/PROJECT_DOCUMENTATION.md`. API reference: Swagger at `/docs`.
