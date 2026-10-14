import type { PreviewDocument } from '../source'

const readers = new WeakMap<() => Promise<Uint8Array | ArrayBuffer>, Map<string, PreviewDocument>>()

export function previewTestDocument(
  size: number,
  mtimeMs: number,
  read: () => Promise<Uint8Array | ArrayBuffer>,
  generation = 0
): PreviewDocument {
  const key = JSON.stringify([size, mtimeMs, generation])
  const cache = readers.get(read) ?? new Map<string, PreviewDocument>()
  readers.set(read, cache)
  let document = cache.get(key)
  if (!document) {
    document = {
      size,
      revision: JSON.stringify({ size, mtimeMs }),
      async readRange(offset, length, signal) {
        signal?.throwIfAborted()
        const data = await read()
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
        return bytes.slice(offset, offset + length)
      },
      async close() {}
    }
    cache.set(key, document)
  }
  return document
}
