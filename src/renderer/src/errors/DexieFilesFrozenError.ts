/**
 * Thrown by the Dexie `db.files` write hooks (creating / updating / deleting)
 * after the Phase 2 file-manager cutover freezes the legacy table.
 *
 * All writes to `db.files` must now go through the v2 File IPC surface
 * (`createInternalEntry` / `ensureExternalEntry`). Read operations are
 * unaffected — `db.files.get` / `db.files.toArray` still work so that
 * Batch A-E consumers can migrate incrementally.
 */
export class DexieFilesFrozenError extends Error {
  constructor(operation: string) {
    super(
      `Cannot ${operation} on the frozen Dexie 'files' table — use v2 File IPC (createInternalEntry / ensureExternalEntry) instead`
    )
    this.name = 'DexieFilesFrozenError'
  }
}
