# README
This primarily serves as a first attempt at writing Property Based Tests with `fast-check`.

This project provides a class `TopologicalSortStream`. This class exposes an `async write(node: Node): Node[]` method (where `Node` is a node in a Directed Acyclic Graph) such that the nodes in the resolved promised are part of a valid topological order.

The class accepts a cache, and an async method for fetching nodes not in the cache, so not all nodes must be in memory. This is useful when incoming nodes are expected to mostly be in order.

The stream can operate with any data type that implements the exported `DAGNode` interface, any cache that implements the exported `NodeCache` interace (essentally `Map<string, T extnends DAGNode>`) and any fn `async (id: string) => Promise<T extends DAGNode | undefined>` for fetching uncached values, so it should be adaptable to your purposes.

NOTE: Performance can be poor (wrt time spent fetching uncached nodes) if the incoming stream is very out of order. This is intended for cases in which the stream is mostly assumed to be in order, but where sporadic out of order nodes would be fatal.

NOTE: The incoming stream is assumed to be idempotent ie a set.
