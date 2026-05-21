---
'@vectorstores/libsql': patch
---

Add `LibSQLVectorStore.replaceByExternalId(externalId, nodes)` — an atomic DELETE + INSERT inside a single libSQL `client.batch(..., 'write')` transaction. Crash-retrying a caller that previously wrote chunks for the same `external_id` no longer leaves orphan chunks (the transaction wipes the prior set atomically), and never destroys pre-existing chunks on insert failure (the transaction rolls back).
