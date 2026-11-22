#include <string.h>
#include "dijkstra.h"
#include "heap.h"

int dijkstra(const Graph *g, int src, double *dist, int *prev, int bu, int bv) {
    if (!g || !dist || !prev || src < 0 || src >= g->n) return -1;
    for (int i = 0; i < g->n; i++) { dist[i] = INF_DIST; prev[i] = -1; }
    MinHeap *h = heap_create(g->m + 2);   /* each successful relaxation pushes once => <= m+1 pushes */
    if (!h) return -1;
    dist[src] = 0.0;
    heap_push(h, src, 0.0);
    HeapItem it;
    while (heap_pop(h, &it)) {
        int u = it.id;
        if (it.key > dist[u]) continue;            /* stale entry */
        for (const Edge *e = g->adj[u]; e; e = e->next) {
            if ((u == bu && e->to == bv) || (u == bv && e->to == bu)) continue;
            double nd = dist[u] + e->w;
            if (nd < dist[e->to]) { dist[e->to] = nd; prev[e->to] = u; heap_push(h, e->to, nd); }
        }
    }
    heap_free(h);
    return 0;
}

Route route_find(const Graph *g, int s, int d, int bu, int bv) {
    Route r;
    memset(&r, 0, sizeof r);
    r.status = ROUTE_INVALID;
    if (!g || s < 0 || d < 0 || s >= g->n || d >= g->n) return r;
    double dist[MAX_NODES]; int prev[MAX_NODES];
    if (dijkstra(g, s, dist, prev, bu, bv) != 0) return r;
    if (dist[d] >= INF_DIST) { r.status = ROUTE_UNREACHABLE; return r; }
    int tmp[MAX_NODES], k = 0;
    for (int v = d; v != -1 && k < g->n; v = prev[v]) tmp[k++] = v;   /* path reconstruction */
    if (k == 0 || tmp[k - 1] != s) return r;
    for (int i = 0; i < k; i++) r.path[i] = tmp[k - 1 - i];
    r.len = k; r.distance = dist[d]; r.status = ROUTE_OK;
    return r;
}
