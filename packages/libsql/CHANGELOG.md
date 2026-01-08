# @vectorstores/libsql

## 0.1.0

### Minor Changes

- fddc11c: Add LibSQL/Turso vector store support with:

  - Vector search (default mode) using native vector32() and vector_distance_cos()
  - BM25 full-text search mode using FTS5
  - Hybrid search mode combining vector + FTS5
  - Metadata filtering with all standard operators
  - Collection management
