CC ?= gcc
CFLAGS = -std=c99 -Wall -Wextra -Werror -O2 -Iinclude
SRC = src/graph.c src/heap.c src/dijkstra.c src/dispatch.c
BUILD = build

all: $(BUILD)/resq_engine

$(BUILD)/resq_engine: $(SRC) src/main.c
	mkdir -p $(BUILD)
	$(CC) $(CFLAGS) $^ -o $@ -lm

$(BUILD)/test_engine: $(SRC) tests/test_engine.c
	mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -g -fsanitize=address,undefined $^ -o $@ -lm

test: $(BUILD)/test_engine
	./$(BUILD)/test_engine

clean:
	rm -rf $(BUILD)

.PHONY: all test clean
