/**
 * Canonical embedding storage format: raw little-endian float32 bytes in a plain
 * BLOB (not libsql's F32_BLOB). The bytes are byte-identical across libsql and
 * better-sqlite3 + sqlite-vec, so switching engines needs no re-encode and no
 * user migration — see knowledge-technical-design.md §5.6 / decision A1.
 */
export function encodeVectorBlob(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 4)
  const view = new DataView(buffer)
  for (let i = 0; i < values.length; i++) {
    view.setFloat32(i * 4, values[i], true)
  }
  return new Uint8Array(buffer)
}
