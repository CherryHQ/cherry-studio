import * as z from 'zod'

// ============ Base Serializable Primitive Types ============
const serializablePrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

/**
 * Serializable type
 */
export type Serializable = string | number | boolean | null | Serializable[] | { [key: string]: Serializable }

/**
 * Zod schema for serializable values
 * Uses z.lazy() to define a recursive type
 */
export const SerializableSchema: z.ZodType<Serializable> = z.lazy(() =>
  z.union([serializablePrimitiveSchema, z.array(SerializableSchema), z.record(z.string(), SerializableSchema)])
)

/**
 * Check if a value is serializable (suitable for Redux state)
 * Supports deep detection of nested objects and arrays
 *
 * @note On circular references: This function returns true when a circular reference is detected,
 *       but JSON.stringify will actually throw an error.
 *       This is historical behavior; callers should be aware.
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
      // Check for circular references
      if (seen.has(val)) {
        return true // Maintain historical behavior: return true when circular reference detected
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
