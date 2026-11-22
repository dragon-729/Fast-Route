#ifndef HEAP_H
#define HEAP_H
typedef struct { int id; double key; } HeapItem;
typedef struct { HeapItem *a; int size, cap; } MinHeap;
MinHeap *heap_create(int cap);
int heap_push(MinHeap *h, int id, double key);   /* 0 ok, -1 full/invalid */
int heap_pop(MinHeap *h, HeapItem *out);         /* 1 popped, 0 empty */
void heap_free(MinHeap *h);
#endif
