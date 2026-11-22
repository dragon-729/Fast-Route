#include <stdlib.h>
#include "graph.h"

Graph *graph_create(int n) {
    if (n <= 0 || n > MAX_NODES) return NULL;
    Graph *g = calloc(1, sizeof *g);
    if (!g) return NULL;
    g->adj = calloc((size_t)n, sizeof(Edge *));
    if (!g->adj) { free(g); return NULL; }
    g->n = n;
    return g;
}
static int add_dir(Graph *g, int u, int v, double w) {
    Edge *e = malloc(sizeof *e);
    if (!e) return -1;
    e->to = v; e->w = w; e->next = g->adj[u]; g->adj[u] = e; g->m++;
    return 0;
}
int graph_add_edge(Graph *g, int u, int v, double w) {
    if (!g || u < 0 || v < 0 || u >= g->n || v >= g->n || u == v || !(w > 0.0) || w > 1e6) return -1;
    if (g->m + 2 > 2 * MAX_EDGES) return -1;
    if (add_dir(g, u, v, w) || add_dir(g, v, u, w)) return -1;
    return 0;
}
void graph_free(Graph *g) {
    if (!g) return;
    for (int i = 0; i < g->n; i++) { Edge *e = g->adj[i]; while (e) { Edge *t = e->next; free(e); e = t; } }
    free(g->adj);
    free(g);
}
