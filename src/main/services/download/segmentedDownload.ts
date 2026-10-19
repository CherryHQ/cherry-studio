/**
 * Pure helpers for splitting one file into byte ranges and tracking how much of
 * each range has arrived. Kept free of I/O so the arithmetic can be tested
 * without a server or a database.
 */

/** Ranges smaller than this are not worth their own connection. */
export const MIN_SEGMENT_BYTES = 4 * 1024 * 1024

/** Hard ceiling on parallel connections for one task. */
export const MAX_SEGMENT_CONNECTIONS = 16

export interface ByteRange {
  index: number
  /** Inclusive. */
  start: number
  /** Exclusive. */
  end: number
}

/**
 * Splits `totalBytes` into at most `connections` contiguous, non-overlapping
 * ranges. The remainder always lands on the earliest ranges, so a plan is
 * deterministic and independent of scheduling order.
 *
 * Returns a single range when the size is unknown (<= 0), the file is smaller
 * than one minimum segment, or only one connection was requested.
 */
export function planSegments(
  totalBytes: number,
  connections: number,
  minSegmentBytes: number = MIN_SEGMENT_BYTES
): ByteRange[] {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return [{ index: 0, start: 0, end: 0 }]
  const requested = Number.isFinite(connections) ? Math.floor(connections) : 1
  const usable = Math.min(
    Math.max(1, requested),
    Math.max(1, Math.ceil(totalBytes / Math.max(1, minSegmentBytes))),
    MAX_SEGMENT_CONNECTIONS
  )
  if (usable === 1) return [{ index: 0, start: 0, end: totalBytes }]

  const base = Math.floor(totalBytes / usable)
  const remainder = totalBytes % usable
  const segments: ByteRange[] = []
  let cursor = 0
  for (let index = 0; index < usable; index++) {
    const size = base + (index < remainder ? 1 : 0)
    segments.push({ index, start: cursor, end: cursor + size })
    cursor += size
  }
  return segments
}

export function segmentLength(range: ByteRange): number {
  return Math.max(0, range.end - range.start)
}

/** Sum of per-segment `received`, clamped to each segment's length. */
export function receivedBytes(ranges: readonly ByteRange[], received: readonly number[]): number {
  let total = 0
  for (const range of ranges) {
    const value = received[range.index] ?? 0
    total += Math.min(Math.max(0, value), segmentLength(range))
  }
  return total
}

/** Byte offset a segment should resume from. */
export function resumeOffset(range: ByteRange, received: number): number {
  return range.start + Math.min(Math.max(0, received), segmentLength(range))
}
