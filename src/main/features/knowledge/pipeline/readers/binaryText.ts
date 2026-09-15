/**
 * Detect binary files that would otherwise be indexed as text mojibake.
 *
 * The knowledge text-reader fallback (`@vectorstores/readers/text`) decodes bytes with a
 * non-fatal `TextDecoder('utf-8')`, so a binary input never throws — it produces text littered
 * with the U+FFFD replacement character. Neither that nor a NUL byte is JS whitespace, so the
 * chunk splitter still emits non-empty chunks and the empty-chunk guard (#19177) passes: the
 * item would complete with embedded garbage. This guard catches that before the file is copied
 * into the base, so a binary file is rejected up front instead of quietly degrading it.
 */

// The prefix (in bytes) sampled from a file's raw content. Matches Git's binary-detection window:
// a NUL in the first 8000 bytes is decisive, and a file with no NUL that far in is treated as text.
export const BINARY_SNIFF_BYTES = 8000

/**
 * True when a file's raw bytes look binary: a NUL byte in the sampled prefix, the same signal Git
 * uses. Runs before any decode, so a binary file is rejected without being read as text.
 *
 * UTF-16 text also has NUL bytes and is rejected — acceptable, since the fallback reader only decodes
 * UTF-8 anyway. Supporting other encodings needs decoding before the reader, not relaxing this sniff.
 */
export function bytesLookBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0)
}
