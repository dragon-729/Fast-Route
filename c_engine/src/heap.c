#include <stdlib.h>
#include "heap.h"

MinHeap *heap_create(int cap) {
    if (cap <= 0 || cap > 10000000) return NULL;
    MinHeap *h = malloc(sizeof *h);
    if (!h) return NULL;
    h->a = malloc((size_t)cap * sizeof(HeapItem));
    if (!h->a) { free(h); return NULL; }
    h->size = 0; h->cap = cap;
    return h;
}
int heap_push(MinHeap *h, int id, double key) {
    if (!h || h->size >= h->cap) return -1;
    int i = h->size++;
    while (i > 0) {
        int p = (i - 1) / 2;
        if (h->a[p].key <= key) break;
        h->a[i] = h->a[p];
        i = p;
    }
    h->a[i].id = id; h->a[i].key = key;
    return 0;
}
int heap_pop(MinHeap *h, HeapItem *out) {
    if (!h || !out || h->size == 0) return 0;
    *out = h->a[0];
    HeapItem last = h->a[--h->size];
    int i = 0;
    for (;;) {
        int c = 2 * i + 1;
        if (c >= h->size) break;
        if (c + 1 < h->size && h->a[c + 1].key < h->a[c].key) c++;
        if (h->a[c].key >= last.key) break;
        h->a[i] = h->a[c];
        i = c;
    }
    if (h->size > 0) h->a[i] = last;
    return 1;
}
void heap_free(MinHeap *h) { if (h) { free(h->a); free(h); } }
