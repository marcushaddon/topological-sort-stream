# README
This project provides a class `TopologicalSortStream`. This class exposes an `async write(node: Node): Node[]` (where `Node` is a node in a Directed Acyclic Graph) method such that the nodes in the resolved promised are part of a valid topological order.

The class accepts a cache, and an async method for fetching nodes not in the cache, so not all nodes must be in memory. This is useful when incoming nodes are expected to mostly be in order.

This also serves as a first attempt at writing Property Based Tests with `fast-check`.
