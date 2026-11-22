#ifndef GRAPH_H
#define GRAPH_H
#define MAX_NODES 256
#define MAX_EDGES 5000
typedef struct Edge { int to; double w; struct Edge *next; } Edge;
typedef struct { int n, m; Edge **adj; } Graph;   /* adjacency list; m = directed edge count */
Graph *graph_create(int n);
int graph_add_edge(Graph *g, int u, int v, double w); /* undirected road; 0 ok, -1 invalid */
void graph_free(Graph *g);
#endif
