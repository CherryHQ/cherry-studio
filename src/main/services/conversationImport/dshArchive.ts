import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { addAbortSignal } from 'node:stream'
import { constants, createZstdDecompress } from 'node:zlib'

import { scanJsonl } from './files'
import { IMPORT_LIMITS } from './types'

async function* decodeFrames(input: Buffer, signal: AbortSignal) {
  // Some Node versions stop at the first frame. The extra byte distinguishes a complete final frame from a short read.
  const end = input.length - 1
  for (let offset = 0; offset < end;) {
    signal.throwIfAborted()
    const decoder = addAbortSignal(signal, createZstdDecompress({ params: { [constants.ZSTD_d_windowLogMax]: 25 } }))
    decoder.end(input.subarray(offset))
    for await (const chunk of decoder) yield chunk as Buffer
    if (!decoder.bytesWritten || offset + decoder.bytesWritten > end) throw new Error('incomplete_source')
    offset += decoder.bytesWritten
  }
}

export async function readDshArchive(file: string, signal: AbortSignal, onLine: (text: string, line: number) => void) {
  if ((await realpath(file)) !== file) throw new Error('source_changed')
  const handle = await open(file, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile() || !before.size) throw new Error('incomplete_source')
    if (before.size > IMPORT_LIMITS.session) throw new Error('session_limit')
    const input = Buffer.alloc(before.size + 1)
    for (let at = 0; at < before.size;) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(input, at, before.size - at, at)
      if (!bytesRead) throw new Error('source_changed')
      at += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('source_changed')
    const decoded = await scanJsonl(decodeFrames(input, signal), signal, onLine)
    return {
      fingerprint: createHash('sha256').update(input.subarray(0, before.size)).digest('hex'),
      bytes: Math.max(before.size, decoded.bytes)
    }
  } finally {
    await handle.close()
  }
}
