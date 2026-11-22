#ifndef DISPATCH_H
#define DISPATCH_H
#include "dijkstra.h"
typedef struct { int status; int index; Route route; } Assignment;
/* Pick the candidate node with the lowest route cost to dest (ties -> lowest index). */
Assignment select_nearest(const Graph *g, int dest, const int *nodes, int k);
/* Emergency priority queue: order by priority (1=P1 first), then FIFO by seq. */
int order_by_priority(const int *pri, const int *seq, int n, int *out);
#endif
