/**
 * Detect binary files that would otherwise be indexed as text mojibake.
 *
 * The knowledge text-reader fallback (`@vectorstores/readers/text`) decodes bytes with a
 * non-fatal `TextDecoder('utf-8')`, so a binary input never throws — it produces text littered
 * with the U+FFFD replacement character. Neither that nor a NUL byte is JS whitespace, so the
 * chunk splitter still emits non-empty chunks and the empty-chunk guard (#19177) passes: the
 * item would complete with embedded garbage. This guard catches that so an explicitly-picked
 * binary file fails the index visibly instead of quietly degrading the base.
 */

// The prefix (in bytes) sampled from a file's raw content. Matches Git's binary-detection window:
// a NUL in the first 8000 bytes is decisive, and a file with no NUL that far in is treated as text.
export const BINARY_SNIFF_BYTES = 8000

/**
 * True when a file's raw bytes look binary: a NUL byte within the sampled prefix is the same signal
 * Git uses to classify a blob as binary. Cheap, cross-platform, and runs before any decode, so a
 * binary file is rejected without being read as text.
 */
export function bytesLookBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0)
}
