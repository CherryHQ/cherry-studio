import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

/**
 * Streaming sha256 of a database main file. Shared by both fingerprint sides
 * (staging writes it, the promotion gate re-computes and compares) so the two
 * can never drift onto different algorithms. Only meaningful after a
 * TRUNCATE checkpoint (see checkpoint.ts): under WAL, committed data sits in
 * the -wal sidecar and the main file's bytes lag until checkpointed.
 */
export async function hashDbFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}
