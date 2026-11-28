import { createRequire } from 'node:module'

import type { xxh3 as NativeXxh3 } from '@node-rs/xxhash'

import { CONTENT_HASH_PATTERN, type ContentHash, ContentHashSchema } from '@shared/data/types/file'

import { createXxh3_64FallbackHasher, xxh3_64Fallback } from './xxh3Fallback'

/** Algorithm tag prefixing content hashes produced by this module. */
export const CONTENT_HASH_ALGO = 'xxh3-64'

const SEED = 0n

type NativeXxh3Module = typeof NativeXxh3

let cachedNativeXxh3: NativeXxh3Module | null | undefined

function getNativeXxh3(): NativeXxh3Module | null {
  if (cachedNativeXxh3 !== undefined) return cachedNativeXxh3
  try {
    const require = createRequire(import.meta.url)
    const mod = require('@node-rs/xxhash') as { xxh3: NativeXxh3Module }
    cachedNativeXxh3 = mod.xxh3
  } catch {
    // Fallback to pure-TS XXH3-64 when the native binding cannot load (e.g. Win7 without WaitOnAddress).
    cachedNativeXxh3 = null
  }
  return cachedNativeXxh3
}

export interface ContentHasher {
  update(chunk: Uint8Array | string): void
  digest(): ContentHash
}

function formatContentHash(digest: bigint): ContentHash {
  return ContentHashSchema.parse(`${CONTENT_HASH_ALGO}:${digest.toString(16).padStart(16, '0')}`)
}

/** Hash content already resident in memory as XXH3-64 with seed 0. */
export function hashContent(data: Uint8Array | string): ContentHash {
  const nativeXxh3 = getNativeXxh3()
  return formatContentHash(nativeXxh3 ? nativeXxh3.xxh64(data, SEED) : xxh3_64Fallback(data))
}

/** Create an incremental XXH3-64 hasher with the same output as {@link hashContent}. */
export function createContentHasher(): ContentHasher {
  const nativeXxh3 = getNativeXxh3()
  const hasher = nativeXxh3 ? nativeXxh3.Xxh3.withSeed(SEED) : createXxh3_64FallbackHasher()
  return {
    update(chunk) {
      hasher.update(chunk)
    },
    digest() {
      return formatContentHash(hasher.digest())
    }
  }
}

export interface ParsedContentHash {
  algo: string
  hex: string
}

/** Parse a validated `{algorithm}:{lowercase hex}` hash without throwing. */
export function parseContentHash(value: string): ParsedContentHash | null {
  const match = CONTENT_HASH_PATTERN.exec(value)
  return match ? { algo: match[1], hex: match[2] } : null
}
