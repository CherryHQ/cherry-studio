import type * as Xxhash from '@node-rs/xxhash'

import { loggerService } from '@logger'
import { CONTENT_HASH_PATTERN, type ContentHash, ContentHashSchema } from '@shared/data/types/file'

const logger = loggerService.withContext('ContentHash')
const xxh3 = loadXxh3()

function loadXxh3(): typeof Xxhash.xxh3 {
  try {
    // Static imports fail before startup error handlers can record the loader's causes.
    return (require('@node-rs/xxhash') as typeof Xxhash).xxh3
  } catch (error) {
    const loadErrors: Error[] = []
    let cause = error instanceof Error ? error.cause : undefined
    while (cause instanceof Error && loadErrors.length < 8) {
      loadErrors.push(cause)
      cause = cause.cause
    }
    logger.error('Failed to load the xxhash native binding', error as Error, {
      operation: 'file.contentHash.loadNativeBinding',
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      loadErrors
    })
    throw error
  }
}

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
