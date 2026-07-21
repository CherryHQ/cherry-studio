import { xxh3 } from '@node-rs/xxhash'
import { CONTENT_HASH_PATTERN, type ContentHash, ContentHashSchema } from '@shared/data/types/file'

/** Algorithm tag prefixing content hashes produced by this module. */
export const CONTENT_HASH_ALGO = 'xxh3-64'

const SEED = 0n

export interface ContentHasher {
  update(chunk: Uint8Array | string): void
  digest(): ContentHash
}

function formatContentHash(digest: bigint): ContentHash {
  return ContentHashSchema.parse(`${CONTENT_HASH_ALGO}:${digest.toString(16).padStart(16, '0')}`)
}

/** Hash content already resident in memory as XXH3-64 with seed 0. */
export function hashContent(data: Uint8Array | string): ContentHash {
  return formatContentHash(xxh3.xxh64(data, SEED))
}

/** Create an incremental XXH3-64 hasher with the same output as {@link hashContent}. */
export function createContentHasher(): ContentHasher {
  const hasher = xxh3.Xxh3.withSeed(SEED)
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
