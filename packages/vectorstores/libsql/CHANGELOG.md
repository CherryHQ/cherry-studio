# @vectorstores/libsql

## 0.1.1

### Patch Changes

- [#14719](https://github.com/CherryHQ/cherry-studio/pull/14719) [`434d4a9`](https://github.com/CherryHQ/cherry-studio/commit/434d4a938f032665e2c451b2fc900fc67ad62d19) Thanks [@eeee0717](https://github.com/eeee0717)! - Align libSQL vector store schema and metadata handling with the V2 knowledge migration/runtime flow.

- [#15213](https://github.com/CherryHQ/cherry-studio/pull/15213) [`84e1732`](https://github.com/CherryHQ/cherry-studio/commit/84e1732d28e2d6439b2ef3d3cc21bfcb7041b3db) Thanks [@0xfullex](https://github.com/0xfullex)! - Add `LibSQLVectorStore.replaceByExternalId(externalId, nodes)` — an atomic DELETE + INSERT inside a single libSQL `client.batch(..., 'write')` transaction. Crash-retrying a caller that previously wrote chunks for the same `external_id` no longer leaves orphan chunks (the transaction wipes the prior set atomically), and never destroys pre-existing chunks on insert failure (the transaction rolls back).

- [#14280](https://github.com/CherryHQ/cherry-studio/pull/14280) [`7f5486c`](https://github.com/CherryHQ/cherry-studio/commit/7f5486ca5135b1c8c08eeba2e6cda6d1ec66940f) Thanks [@eeee0717](https://github.com/eeee0717)! - Remove libSQL vector index and `vector_top_k` usage from the knowledge vector store query path.

## 0.1.0

### Minor Changes

- fddc11c: Add LibSQL/Turso vector store support with:

  - Vector search (default mode) using native vector32() and vector_distance_cos()
  - BM25 full-text search mode using FTS5
  - Hybrid search mode combining vector + FTS5
  - Metadata filtering with all standard operators
  - Collection management
