// Observation records contain large immutable strings. Copy containers without serializing their contents.
export function cloneHistoryData<T>(value: T): T {
  const copies = new WeakMap<object, object>()

  const copy = <Value>(source: Value): Value => {
    if (typeof source === 'function') {
      // oxlint-disable-next-line no-restricted-globals -- Preserve the native clone error for unsupported payloads.
      return structuredClone(source)
    }

    if (source === null || typeof source !== 'object') return source
    const existing = copies.get(source)

    // SAFETY: Each cached object is the copy registered for this exact source identity.
    if (existing !== undefined) return existing as Value
    const array = Array.isArray(source)
    const prototype = Object.getPrototypeOf(source)

    if (!array && prototype !== Object.prototype && prototype !== null) {
      // oxlint-disable-next-line no-restricted-globals -- Use the native clone for non-JSON values.
      const result = structuredClone(source)
      copies.set(source, result)

      return result
    }

    const result = array ? new Array(source.length) : {}
    copies.set(source, result)

    for (const [key, value] of Object.entries(source)) {
      Object.defineProperty(result, key, { value: copy(value), enumerable: true, writable: true, configurable: true })
    }

    // SAFETY: Recursive copies preserve the source's enumerable data shape and shared references.
    return result as Value
  }

  return copy(value)
}
