// Fingerprint producer — captures the live DB fingerprint after quiesce, before
// createSnapshot. This is the C-import staging side of the #16884 fingerprint
// contract (the gate side is the consumer). See plan (c) + #16884 README
// "Writer requirements (staging side)" item 1.
//
// Sequence (after drain verdict): checkpointTruncate() → hashDbFile(livePath) →
// carry the captured value into the staged journal (written atomically at end of
// staging — a preboot-consumable journal must never exist before merge is complete
// and sealed). VACUUM INTO (createSnapshot) is a read tx — leaves the live main
// file untouched, so the hash stays valid and work.sqlite is built from exactly the
// fingerprinted state.
//
// Assert throws (busy!=0 on single-connection) → quiesce-leak / foreign connection
// → abort staging (fail-closed, same posture as drain-clean-or-abort).

import type { DbService } from '@main/data/db/DbService'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'

/**
 * Capture the live DB fingerprint after quiesce.
 *
 * MUST run after drain verdict (quiesce guarantees no in-flight writers → busy==0).
 * The captured value is carried in memory into the staged journal (written
 * atomically at end of staging).
 *
 * @param dbService - the live DbService (single better-sqlite3 connection)
 * @param livePath - absolute path to the live DB main file
 * @returns the fingerprint (sha256 of the live main file, post-TRUNCATE-checkpoint)
 * @throws if checkpointTruncateAssert fails (busy!=0) — treat as quiesce-leak,
 *   abort the restore attempt (fail-closed)
 */
export async function captureLiveFingerprint(dbService: DbService, livePath: string): Promise<string> {
  // checkpointTruncateAssert on the live connection; throws if busy!=0 (quiesce leak
  // or foreign connection). The single-connection design makes busy==0 trivially
  // hold once writers are drained.
  dbService.checkpointTruncate()
  // Streaming sha256 of the main file (WAL folded in by the checkpoint above).
  return hashDbFile(livePath)
}
