/* ResQRoute C engine: reads a graph + one command on stdin, prints one JSON object. */
#include <stdio.h>
#include <string.h>
#include "graph.h"
#include "dijkstra.h"
#include "dispatch.h"

#define ALT_MAX 8
static double g_speed = 40.0;

static void print_route(const Route *r) {
    if (r->status != ROUTE_OK) {
        printf("{\"status\":\"%s\"}", r->status == ROUTE_UNREACHABLE ? "UNREACHABLE" : "INVALID");
        return;
    }
    printf("{\"status\":\"OK\",\"distance\":%.3f,\"minutes\":%.2f,\"path\":[", r->distance, r->distance / g_speed * 60.0);
    for (int i = 0; i < r->len; i++) printf("%s%d", i ? "," : "", r->path[i]);
    printf("]}");
}
static int same_path(const Route *a, const Route *b) {
    return a->len == b->len && memcmp(a->path, b->path, (size_t)a->len * sizeof(int)) == 0;
}
static int fail(Graph *g, const char *msg) {
    printf("{\"status\":\"INVALID\",\"error\":\"%s\"}\n", msg);
    graph_free(g);
    return 2;
}

int main(void) {
    int n, m; double speed;
    if (scanf("%d %d %lf", &n, &m, &speed) != 3 || m < 0 || m > MAX_EDGES || !(speed > 0.0) || speed > 500.0)
        return fail(NULL, "bad header");
    g_speed = speed;
    Graph *g = graph_create(n);
    if (!g) return fail(NULL, "bad node count");
    for (int i = 0; i < m; i++) {
        int u, v; double w;
        if (scanf("%d %d %lf", &u, &v, &w) != 3 || graph_add_edge(g, u, v, w) != 0) return fail(g, "bad edge");
    }
    char cmd[16];
    if (scanf("%15s", cmd) != 1) return fail(g, "missing command");

    if (strcmp(cmd, "ROUTE") == 0) {
        int s, d;
        if (scanf("%d %d", &s, &d) != 2) return fail(g, "bad args");
        Route r = route_find(g, s, d, -1, -1);
        print_route(&r);
    } else if (strcmp(cmd, "ASSIGN") == 0) {
        int dest, k, nodes[MAX_NODES];
        if (scanf("%d %d", &dest, &k) != 2 || k < 1 || k > MAX_NODES) return fail(g, "bad args");
        for (int i = 0; i < k; i++) if (scanf("%d", &nodes[i]) != 1) return fail(g, "bad args");
        Assignment a = select_nearest(g, dest, nodes, k);
        if (a.status == ROUTE_OK) { printf("{\"status\":\"OK\",\"index\":%d,\"route\":", a.index); print_route(&a.route); printf("}"); }
        else printf("{\"status\":\"%s\"}", a.status == ROUTE_UNREACHABLE ? "UNREACHABLE" : "INVALID");
    } else if (strcmp(cmd, "ALT") == 0) {
        int s, d;
        if (scanf("%d %d", &s, &d) != 2) return fail(g, "bad args");
        Route base = route_find(g, s, d, -1, -1);
        if (base.status != ROUTE_OK) {
            printf("{\"status\":\"%s\",\"routes\":[]}", base.status == ROUTE_UNREACHABLE ? "UNREACHABLE" : "INVALID");
        } else {
            Route alts[ALT_MAX]; int cnt = 0;
            for (int i = 0; i + 1 < base.len; i++) {   /* block each road of the best route, re-run Dijkstra */
                Route r = route_find(g, s, d, base.path[i], base.path[i + 1]);
                if (r.status != ROUTE_OK || same_path(&r, &base)) continue;
                int dup = 0;
                for (int j = 0; j < cnt; j++) if (same_path(&r, &alts[j])) dup = 1;
                if (!dup && cnt < ALT_MAX) alts[cnt++] = r;
            }
            for (int i = 1; i < cnt; i++) {
                Route t = alts[i]; int j = i - 1;
                while (j >= 0 && alts[j].distance > t.distance) { alts[j + 1] = alts[j]; j--; }
                alts[j + 1] = t;
            }
            printf("{\"status\":\"OK\",\"primary\":"); print_route(&base); printf(",\"routes\":[");
            for (int i = 0; i < cnt && i < 3; i++) { if (i) printf(","); print_route(&alts[i]); }
            printf("]}");
        }
    } else if (strcmp(cmd, "PQ") == 0) {
        static int pri[MAX_EDGES], seq[MAX_EDGES], out[MAX_EDGES];
        int cnt;
        if (scanf("%d", &cnt) != 1 || cnt < 0 || cnt > MAX_EDGES) return fail(g, "bad args");
        for (int i = 0; i < cnt; i++) if (scanf("%d %d", &pri[i], &seq[i]) != 2) return fail(g, "bad args");
        int k = order_by_priority(pri, seq, cnt, out);
        if (k < 0) return fail(g, "bad priority");
        printf("{\"status\":\"OK\",\"order\":[");
        for (int i = 0; i < k; i++) printf("%s%d", i ? "," : "", out[i]);
        printf("]}");
    } else {
        return fail(g, "unknown command");
    }
    putchar('\n');
    graph_free(g);
    return 0;
}
