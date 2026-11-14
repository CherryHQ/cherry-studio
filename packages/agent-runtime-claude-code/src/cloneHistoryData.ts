// Observation records contain large immutable strings. Copy containers without serializing their contents.
export function cloneHistoryData<T>(value: T): T
export function cloneHistoryData(value: unknown): unknown {
  const copies = new WeakMap<object, unknown>()
  const copy = (source: unknown): unknown => {
    if (typeof source === 'function') return structuredClone(source)
    if (source === null || typeof source !== 'object') return source
    if (copies.has(source)) return copies.get(source)
    const array = Array.isArray(source)
    const prototype = Object.getPrototypeOf(source)
    if (!array && prototype !== Object.prototype && prototype !== null) {
      const result = structuredClone(source)
      copies.set(source, result)
      return result
    }
    const result = array ? new Array(source.length) : {}
    copies.set(source, result)
    for (const [key, value] of Object.entries(source)) {
      Object.defineProperty(result, key, { value: copy(value), enumerable: true, writable: true, configurable: true })
    }
    return result
  }
  return copy(value)
}
