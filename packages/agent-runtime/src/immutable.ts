const shared = new WeakSet<object>()

/**
 * Returns a deep-frozen copy of observation data. Values already returned by this function are reused,
 * so repeated snapshots share unchanged messages and strings instead of copying them. The caller's
 * containers are copied rather than frozen. Non-plain objects (dates, typed arrays, errors) are copied
 * once with `structuredClone` and shared unfrozen; functions and symbols are rejected.
 *
 * @param value - Observation data owned by the caller.
 * @returns An immutable value safe to share between the publisher, the feed state and every observer.
 */
export function immutable<T>(value: T): T
export function immutable(value: unknown): unknown {
  const copies = new WeakMap<object, unknown>()
  const copy = (source: unknown): unknown => {
    if (typeof source === 'function' || typeof source === 'symbol') {
      // oxlint-disable-next-line no-restricted-globals -- Preserve the native clone error for unsupported payloads.
      return structuredClone(source)
    }
    if (source === null || typeof source !== 'object' || shared.has(source)) return source
    if (copies.has(source)) return copies.get(source)
    const array = Array.isArray(source)
    const prototype = Object.getPrototypeOf(source)
    if (!array && prototype !== Object.prototype && prototype !== null) {
      // oxlint-disable-next-line no-restricted-globals -- Use the native clone for non-JSON values.
      const result = structuredClone(source)
      copies.set(source, result)
      shared.add(result)
      return result
    }
    const result: Record<string, unknown> | unknown[] = array ? new Array(source.length) : {}
    copies.set(source, result)
    for (const [key, child] of Object.entries(source)) {
      Object.defineProperty(result, key, { value: copy(child), enumerable: true, writable: true, configurable: true })
    }
    Object.freeze(result)
    shared.add(result)
    return result
  }
  return copy(value)
}
