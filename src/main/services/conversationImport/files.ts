import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

import { IMPORT_LIMITS } from './types'

export async function* discoverJsonl(root: string, signal: AbortSignal, depth = 0): AsyncIterable<string> {
  signal.throwIfAborted()
  if (depth > 4) return
  for (const entry of await readdir(root, { withFileTypes: true })) {
    signal.throwIfAborted()
    if (entry.isSymbolicLink()) continue
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) yield* discoverJsonl(file, signal, depth + 1)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield file
  }
}

export async function readJsonl(
  file: string,
  signal: AbortSignal
): Promise<{
  lines: { text: string; line: number }[]
  fingerprint: string
  bytes: number
}> {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('source_changed')
  if (stat.size > IMPORT_LIMITS.session) throw new Error('session_limit')
  const hash = createHash('sha256')
  let bytes = 0
  let remainder = Buffer.alloc(0)
  let number = 0
  const lines: { text: string; line: number }[] = []
  for await (const chunk of createReadStream(file, { signal })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > IMPORT_LIMITS.session) throw new Error('session_limit')
    hash.update(buffer)
    const pending = Buffer.concat([remainder, buffer])
    let offset = 0
    for (let end = pending.indexOf(10); end >= 0; end = pending.indexOf(10, offset)) {
      if (end - offset > IMPORT_LIMITS.line) throw new Error('line_limit')
      lines.push({ text: pending.toString('utf8', offset, end), line: ++number })
      offset = end + 1
    }
    remainder = pending.subarray(offset)
    if (remainder.length > IMPORT_LIMITS.line) throw new Error('line_limit')
  }
  if (remainder.length) lines.push({ text: remainder.toString('utf8'), line: ++number })
  return { lines, fingerprint: hash.digest('hex'), bytes }
}
