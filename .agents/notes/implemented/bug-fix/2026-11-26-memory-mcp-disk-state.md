# Agent Note: Keep the memory MCP graph on disk only

Status: implemented

English | [中文](2026-11-26-memory-mcp-disk-state.zh.md)

## Problem

The built-in `@cherry/memory` server loaded `memory.json` once into an in-memory graph and wrote it back after each change. A failed write left the change in memory, so a retried `create_entities` skipped the entity as existing and never saved it. A failing entry in `add_observations` left earlier entries changed in memory. An unparseable file was overwritten with an empty graph, and a valid file with the wrong shape failed at startup.

## Decision

The memory file is the only state. Every tool call reads it under one mutex; a change applies to that fresh copy and is written with `atomicWriteFile`, so a failed call discards its change. Reads and writes resolve symlinks to the real file and keep its permissions. The file is validated with a lenient schema: missing `observations`, `entities`, or `relations` default to empty, and unknown entity fields are kept. An unparseable or wrong-shaped file is renamed to `memory.json.corrupt-<timestamp>` and the server starts from an empty graph.

## Alternatives considered

Keeping the in-memory cache and rolling it back on a failed write would fix only the write path; the cache would still ignore hand edits made while the app runs and overwrite them on the next write. Overwriting a corrupt file loses the user's data, and failing every call on a wrong-shaped file leaves the server unusable.

## Consequences

Each tool call reads and parses the whole file, which is acceptable for knowledge graphs of this size. `memory.json` is created on the first write instead of at startup. Hand edits made while the app runs are picked up by the next call. A read-only call such as `read_graph` can move a corrupt file aside.

## Verification

- Regression — `memory.test.ts` "persists an entity when the call is retried after a failed write": fails on the in-memory implementation because the retried entity is never saved.
- Regression — `memory.test.ts` "leaves earlier entities untouched when add_observations fails on a later one": catches a partial change surviving a failed call.
- Regression — `memory.test.ts` "moves a memory file holding … aside": covers truncated JSON, `null`, and non-list entities being backed up instead of overwritten.
- Regression — `memory.test.ts` "reads a memory file whose entities lack observations and that has no relations": catches an over-strict schema moving a readable file aside.
- Regression — `memory.test.ts` "writes through a symlinked memory path" and "keeps the permissions of an existing memory file": catch the atomic rename replacing a symlink or resetting permissions.
