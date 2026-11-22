#include <stdio.h>
#include <math.h>
#include "graph.h"
#include "heap.h"
#include "dijkstra.h"
#include "dispatch.h"

static int total = 0, failed = 0;
#define CHECK(name, cond) do { total++; if (cond) printf("  ok   %s\n", name); else { failed++; printf("  FAIL %s\n", name); } } while (0)

static Graph *sample(void) {   /* classic 6-node graph + isolated node 6 */
    Graph *g = graph_create(7);
    int e[][2] = {{0,1},{0,2},{0,5},{1,2},{1,3},{2,3},{2,5},{3,4},{4,5}};
    double w[] = {7, 9, 14, 10, 15, 11, 2, 6, 9};
    for (int i = 0; i < 9; i++) graph_add_edge(g, e[i][0], e[i][1], w[i]);
    return g;
}

int main(void) {
    printf("Graph\n");
    CHECK("create rejects 0 nodes", graph_create(0) == NULL);
    CHECK("create rejects > MAX_NODES", graph_create(MAX_NODES + 1) == NULL);
    Graph *g = sample();
    CHECK("create ok", g != NULL && g->n == 7);
    CHECK("edge: bad node rejected", graph_add_edge(g, 0, 99, 1) == -1);
    CHECK("edge: self loop rejected", graph_add_edge(g, 2, 2, 1) == -1);
    CHECK("edge: zero/negative weight rejected", graph_add_edge(g, 0, 1, 0) == -1 && graph_add_edge(g, 0, 1, -3) == -1);
    CHECK("edge: NaN weight rejected", graph_add_edge(g, 0, 1, NAN) == -1);
    CHECK("edges stored both ways (m = 18)", g->m == 18);

    printf("Dijkstra\n");
    Route r = route_find(g, 0, 4, -1, -1);
    CHECK("0->4 distance is 20", r.status == ROUTE_OK && fabs(r.distance - 20.0) < 1e-9);
    CHECK("0->4 path is 0,2,5,4", r.len == 4 && r.path[0] == 0 && r.path[1] == 2 && r.path[2] == 5 && r.path[3] == 4);
    r = route_find(g, 3, 3, -1, -1);
    CHECK("src == dst gives distance 0, len 1", r.status == ROUTE_OK && r.len == 1 && r.distance == 0.0);
    CHECK("isolated node unreachable", route_find(g, 0, 6, -1, -1).status == ROUTE_UNREACHABLE);
    CHECK("invalid node handled", route_find(g, 0, 7, -1, -1).status == ROUTE_INVALID && route_find(g, -1, 2, -1, -1).status == ROUTE_INVALID);
    r = route_find(g, 0, 4, 2, 5);
    CHECK("blocked road 2-5 reroutes via 0,5,4 (23)", r.status == ROUTE_OK && fabs(r.distance - 23.0) < 1e-9 && r.len == 3 && r.path[1] == 5);
    double sum = 0; r = route_find(g, 0, 4, -1, -1);
    for (int i = 0; i + 1 < r.len; i++) for (Edge *e = g->adj[r.path[i]]; e; e = e->next) if (e->to == r.path[i+1]) { sum += e->w; break; }
    CHECK("route distance equals sum of edge weights", fabs(sum - r.distance) < 1e-9);

    printf("Ambulance selection\n");
    int c1[] = {0, 1, 3};
    Assignment a = select_nearest(g, 4, c1, 3);
    CHECK("nearest to node 4 among {0,1,3} is index 2", a.status == ROUTE_OK && a.index == 2 && fabs(a.route.distance - 6.0) < 1e-9);
    int c2[] = {6};
    CHECK("only unreachable candidate -> UNREACHABLE", select_nearest(g, 4, c2, 1).status == ROUTE_UNREACHABLE);
    int c3[] = {1, 9};
    CHECK("invalid candidate -> INVALID", select_nearest(g, 4, c3, 2).status == ROUTE_INVALID);
    int c4[] = {6, 0};
    CHECK("skips unreachable, picks reachable", select_nearest(g, 4, c4, 2).index == 1);
    graph_free(g);

    printf("Heap / priority queue\n");
    MinHeap *h = heap_create(8);
    double keys[] = {5, 3, 8, 1, 9, 2};
    for (int i = 0; i < 6; i++) heap_push(h, i, keys[i]);
    HeapItem it; double last = -1; int sorted = 1, n = 0;
    while (heap_pop(h, &it)) { if (it.key < last) sorted = 0; last = it.key; n++; }
    CHECK("heap pops in ascending order", sorted && n == 6);
    CHECK("pop on empty heap returns 0", heap_pop(h, &it) == 0);
    for (int i = 0; i < 8; i++) heap_push(h, i, i);
    CHECK("push beyond capacity rejected", heap_push(h, 9, 1) == -1);
    heap_free(h);
    int pri[] = {2, 1, 2, 4, 1}, seq[] = {0, 1, 2, 3, 4}, out[5];
    int k = order_by_priority(pri, seq, 5, out);
    CHECK("P1 first, FIFO within priority", k == 5 && out[0] == 1 && out[1] == 4 && out[2] == 0 && out[3] == 2 && out[4] == 3);
    int bad[] = {5};
    CHECK("invalid priority rejected", order_by_priority(bad, seq, 1, out) == -1);
    CHECK("empty queue ok", order_by_priority(NULL, NULL, 0, NULL) == 0);

    printf("\n%d/%d checks passed\n", total - failed, total);
    return failed ? 1 : 0;
}
