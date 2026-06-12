import * as z from 'zod'

/**
 * Serializable type
 */
export type Serializable = string | number | boolean | null | Serializable[] | { [key: string]: Serializable }

/**
 * Zod schema for serializable values
 * Uses z.custom() with isSerializable type guard to ensure consistent validation behavior
 */
export const SerializableSchema: z.ZodType<Serializable> = z.custom<Serializable>(isSerializable)

/**
 * Check if a value is serializable (suitable for Redux state)
 * Supports deep detection of nested objects and arrays
 */
export function isSerializable(value: unknown): value is Serializable {
  const seen = new Set<unknown>()

  function _isSerializable(val: unknown): boolean {
    if (val === null || val === undefined) {
      return val !== undefined
    }

    const type = typeof val

    if (type === 'string' || type === 'number' || type === 'boolean') {
      return true
    }

    if (type === 'object') {
      // Circular references are not JSON-serializable
      if (seen.has(val)) {
        return false
      }
      seen.add(val)

      if (Array.isArray(val)) {
        return val.every((item) => _isSerializable(item))
      }

      // Check if it's a plain object
      const proto = Object.getPrototypeOf(val)
      if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
        return false
      }

      // Check for built-in objects (Date, RegExp, Map, Set, etc.)
      if (
        val instanceof Date ||
        val instanceof RegExp ||
        val instanceof Map ||
        val instanceof Set ||
        val instanceof Error ||
        val instanceof File ||
        val instanceof Blob
      ) {
        return false
      }

      // Recursively check all property values
      return Object.values(val).every((v) => _isSerializable(v))
    }

    // function, symbol are not serializable
    return false
  }

  try {
    return _isSerializable(value)
  } catch {
    return false
  }
}
