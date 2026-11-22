#include <string.h>
#include "dispatch.h"
#include "heap.h"

Assignment select_nearest(const Graph *g, int dest, const int *nodes, int k) {
    Assignment a;
    memset(&a, 0, sizeof a);
    a.status = ROUTE_INVALID; a.index = -1;
    if (!g || !nodes || k <= 0 || dest < 0 || dest >= g->n) return a;
    for (int i = 0; i < k; i++) if (nodes[i] < 0 || nodes[i] >= g->n) return a;
    double dist[MAX_NODES]; int prev[MAX_NODES];
    if (dijkstra(g, dest, dist, prev, -1, -1) != 0) return a;   /* roads are two-way: cost(a,b)==cost(b,a) */
    int best = -1;
    for (int i = 0; i < k; i++) {
        double d = dist[nodes[i]];
        if (d < INF_DIST && (best < 0 || d < dist[nodes[best]])) best = i;
    }
    if (best < 0) { a.status = ROUTE_UNREACHABLE; return a; }
    a.route = route_find(g, nodes[best], dest, -1, -1);
    a.index = best; a.status = a.route.status;
    return a;
}

int order_by_priority(const int *pri, const int *seq, int n, int *out) {
    if (n < 0 || (n > 0 && (!pri || !seq || !out))) return -1;
    MinHeap *h = heap_create(n + 1);
    if (!h) return -1;
    for (int i = 0; i < n; i++) {
        if (pri[i] < 1 || pri[i] > 4 || seq[i] < 0 || seq[i] >= 1000000000 ||
            heap_push(h, i, pri[i] * 1e9 + seq[i]) != 0) { heap_free(h); return -1; }
    }
    int k = 0; HeapItem it;
    while (heap_pop(h, &it)) out[k++] = it.id;
    heap_free(h);
    return k;
}
