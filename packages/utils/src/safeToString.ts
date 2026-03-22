/**
 * Safely converts any value to a string.
 *
 * - null → 'null'
 * - undefined → 'undefined'
 * - Strings are returned as-is
 * - Primitive types (numbers, booleans, bigints, etc.) are converted using String()
 * - Functions are converted using Function.prototype.toString()
 * - Objects and arrays are serialized using JSON.stringify, with circular reference handling
 * - If serialization fails, an error message is returned
 *
 * @example
 * ```ts
 * safeToString(null)       // 'null'
 * safeToString(undefined)  // 'undefined'
 * safeToString('test')     // 'test'
 * safeToString(123)        // '123'
 * safeToString({a: 1})     // '{"a":1}'
 * ```
 */

export function safeToString(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value !== 'object' && typeof value !== 'function') {
    return String(value as string | number | boolean | symbol | bigint)
  }

  if (typeof value === 'function') {
    return value.toString()
  }

  try {
    const seen = new WeakSet()
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }
      return val
    })
  } catch (err) {
    return '[Unserializable: ' + (err instanceof Error ? err.message : 'unknown error') + ']'
  }
}
