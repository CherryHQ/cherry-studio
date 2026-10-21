# Connector credentials

`CredentialStoreService` owns main-process plaintext connector credentials. Resolve it through
`application.get('CredentialStoreService')` after its WhenReady lifecycle initialization.
Channel and Knowledge still use their existing credential writers; their migration and cutover
are a subsequent implementation layer.

Each UUID names one strict-schema JSON record under `feature.credentials`
(`{userData}/Credentials/connectors`), outside backup-managed `Data`. The store creates the
directory with `0700` and writes files atomically with `0600` on POSIX. These permissions do
not encrypt the contents. Corrupt and unreadable records remain on disk and are reported
separately from missing records.

Application records hold Feishu/Lark application secrets; user-authorization records reference
an application and hold a complete token set or `null` while authorization is pending.
`read` is main-only. The `credential.*` IpcApi routes expose summaries and accept manual
application input; there is no saved-secret read/export route or DataApi resource.

All operations share one queue. `withReferences(ids, commit)` validates the records and runs
`commit(records, tx)` synchronously in a database write transaction. The callback must not
await or re-enter the store. New binding writers must use this boundary; otherwise they can
race deletion. File commits and database commits are not one transaction.

`remove(id, isReferenced)` requires a synchronous business-reference predicate, executed
in the same queue as binding admission and grant-to-application checks. The connection layer
owns that predicate and deletion IPC; this foundation imports no consumer tables. Unknown usage caused by a corrupt record blocks removal. Deleting a business
binding does not delete its application. No startup orphan sweep runs here.

Token rotation requires the expected refresh token and application snapshot. A replaced
application, rotated token or deleted grant cannot be overwritten by an old response.
Application changes emit only ID, kind and operation; listeners fence their old work
synchronously before starting asynchronous reconciliation.

Tests use real temporary files and the production SQLite migrations through
`setupTestDatabase()`. See the [design record](../../../../.agents/notes/proposed/architecture/2026-10-21-shared-connector-credentials.md)
for migration, consumer cutover and desktop acceptance still to be implemented.
