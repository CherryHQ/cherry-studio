/**
 * Content hashing primitive for file dedup detection.
 *
 * Produces the `{algo}:{hex}` value persisted in `file_entry.contentHash` — a
 * **detection substrate**, not an identity and not a unique key. The algorithm
 * tag is part of the stored contract: it lets a future algorithm change coexist
 * with old values via incremental migration instead of a flag-day re-hash.
 *
 * Algorithm: **XXH3-64** via the native `@node-rs/xxhash`. 64-bit (not 128)
 * because `@node-rs/xxhash` only exposes a streaming/incremental digest for the
 * 64-bit variant (the `Xxh3` class); its 128-bit hash is one-shot only and
 * would force whole-file buffering on the streaming write paths (copy /
 * download / createWriteStream). 64 bits is sufficient for a *detection*
 * substrate: a collision at worst surfaces a wrong candidate that the
 * consumer's secondary check rejects — never mis-served bytes. See
 * file-manager-architecture.md.
 */

import { xxh3 } from '@node-rs/xxhash'
import { CONTENT_HASH_PATTERN, type ContentHash } from '@shared/data/types/file/essential'

/** Algorithm tag prefixing every stored content hash (`{CONTENT_HASH_ALGO}:{hex}`). */
export const CONTENT_HASH_ALGO = 'xxh3-64'

/** Incremental content hasher driving the fold-into-pipe streaming path. */
export interface ContentHasher {
  /** Feed the next chunk. Buffers are accepted zero-copy (Buffer ⊂ Uint8Array). */
  update(chunk: Uint8Array | string): void
  /** Finalize to the branded `{algo}:{hex}` contract value. */
  digest(): ContentHash
}

const SEED = 0n

/**
 * 64-bit digest → algorithm-tagged, fixed-width 16-char lowercase hex. The lone
 * sanctioned mint site for the `ContentHash` brand (mirrors
 * `canonicalizeExternalPath` for `CanonicalExternalPath`): the value is, by
 * construction, the canonical `{algo}:{hex}` form, so the `as` cast is sound.
 */
function format(digest: bigint): ContentHash {
  return `${CONTENT_HASH_ALGO}:${digest.toString(16).padStart(16, '0')}` as ContentHash
}

/**
 * One-shot content hash of in-memory content → `xxh3-64:{hex}`.
 *
 * For content already resident in memory (base64 / bytes sources, the
 * `string | Uint8Array` write paths). A `string` is hashed as its UTF-8 bytes,
 * matching `Buffer.from(str)` — so identical content hashed as a string or as
 * bytes yields the same value.
 */
export function hashContent(data: Uint8Array | string): ContentHash {
  return format(xxh3.xxh64(data, SEED))
}

/**
 * Create an incremental hasher for fold-into-pipe streaming (zero-extra-IO):
 * feed each chunk as it flows through a copy / download / write pipeline, then
 * `digest()`. Produces the SAME value as {@link hashContent} over the
 * concatenated chunks (streaming `Xxh3.digest()` ≡ one-shot `xxh3.xxh64`), so a
 * detect-first consumer that pre-hashed in memory and a create path that hashed
 * in-pipe agree on the key.
 */
export function createContentHasher(): ContentHasher {
  const hasher = xxh3.Xxh3.withSeed(SEED)
  return {
    update(chunk) {
      hasher.update(chunk)
    },
    digest() {
      return format(hasher.digest())
    }
  }
}

/** The decomposed parts of a stored `{algo}:{hex}` content hash. */
export interface ParsedContentHash {
  /** Algorithm tag (e.g. `xxh3-64`) — lets consumers branch during a future algorithm migration. */
  algo: string
  /** Lowercase-hex digest body. */
  hex: string
}

/**
 * Parse a stored content hash into its `{ algo, hex }` parts — the inverse of
 * the `{algo}:{hex}` format that {@link hashContent} / {@link createContentHasher}
 * produce. Splits on the first `:`; the algorithm tag is surfaced so consumers
 * can detect/branch during a future algorithm migration (the whole reason the
 * tag is part of the stored contract).
 *
 * Returns `null` — never throws — for a value that doesn't match the
 * `{algo}:{hex}` shape, validated against the same `CONTENT_HASH_PATTERN` that
 * backs {@link ContentHashSchema} (its `(algo)(hex)` capture groups are what we
 * decompose here). `null` (not an exception) is the right shape: a stored value
 * can be malformed (legacy / corrupted data), and callers branch on presence
 * rather than wrap every read in try/catch. Pure function.
 */
export function parseContentHash(value: string): ParsedContentHash | null {
  const match = CONTENT_HASH_PATTERN.exec(value)
  if (!match) return null
  return { algo: match[1], hex: match[2] }
}
