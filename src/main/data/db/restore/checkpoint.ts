import type Database from 'better-sqlite3'

/**
 * `wal_checkpoint(TRUNCATE)` with a completeness assertion. Shared by both
 * fingerprint sides — DbService on the live connection at staging time, and
 * the promotion gate's temporary preboot connection — so "checkpoint then
 * hash" is structurally symmetric (see hashDbFile.ts).
 *
 * A half-done checkpoint hashes wrong: committed rows still sitting in the
 * -wal would be invisible to the main-file hash, so busy readers or a
 * shorter-than-log checkpoint must abort loudly instead of proceeding.
 */
export function checkpointTruncateAssert(sqlite: Database.Database): void {
  const [row] = sqlite.pragma('wal_checkpoint(TRUNCATE)') as Array<{
    busy: number
    log: number
    checkpointed: number
  }>
  if (!row || row.busy !== 0 || row.log !== row.checkpointed) {
    throw new Error(
      `wal_checkpoint(TRUNCATE) did not complete: busy=${row?.busy}, log=${row?.log}, checkpointed=${row?.checkpointed}`
    )
  }
}
