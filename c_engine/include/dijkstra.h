#ifndef DIJKSTRA_H
#define DIJKSTRA_H
#include "graph.h"
#define INF_DIST 1e18
enum { ROUTE_OK = 1, ROUTE_UNREACHABLE = 0, ROUTE_INVALID = -1 };
typedef struct { int status; double distance; int len; int path[MAX_NODES]; } Route;
/* Single-source shortest paths. (bu,bv) = optional blocked road (-1,-1 for none). */
int dijkstra(const Graph *g, int src, double *dist, int *prev, int bu, int bv);
Route route_find(const Graph *g, int s, int d, int bu, int bv);
#endif
