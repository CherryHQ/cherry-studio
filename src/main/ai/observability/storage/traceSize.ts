// Conservative serialized-size estimate without allocating another copy of captured bodies.
export function estimateTraceValueBytes(value: unknown, seen = new Set<object>()): number {
  if (typeof value === 'string') return value.length * 6 + 2
  if (value === null || typeof value !== 'object') return 16
  if (seen.has(value)) return 0
  seen.add(value)
  let bytes = 32
  for (const [key, child] of Object.entries(value)) {
    bytes += key.length * 6 + 4 + estimateTraceValueBytes(child, seen)
  }
  return bytes
}
