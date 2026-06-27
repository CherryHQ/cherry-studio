// Backup neutral layer — deepFreeze helper.
//
// Each BackupContributor SHALL be a frozen constant object (not a class). deepFreeze
// recursively freezes the schema / policy plain-object graph at module load so any
// accidental mutation of contributor facts fails loudly in development. Used by
// contributor declarations: `export const TOPICS_CONTRIBUTOR = deepFreeze({ ... })`.

/**
 * Recursively freeze a plain-object / array graph in place and return it.
 *
 * Only plain objects (proto === Object.prototype or null) and arrays are descended
 * into — non-plain values (Date, Map, Set, class instances, functions) are left
 * untouched to avoid corrupting runtime semantics. Cycles are tolerated via the
 * Object.isFrozen guard (a frozen object is not re-descended).
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }

  // Skip non-plain objects: freezing a Date/Map/Set/class instance would break its
  // internal slots. Contributor facts are plain object graphs.
  const proto = Object.getPrototypeOf(value)
  const isPlain = proto === Object.prototype || proto === Array.prototype || proto === null
  if (!isPlain) {
    return value
  }

  // Cycle guard: an already-frozen object is not re-descended.
  if (Object.isFrozen(value)) {
    return value
  }

  Object.freeze(value)

  // Reflect.ownKeys covers string + symbol keys (skip inherited).
  for (const key of Reflect.ownKeys(value as object)) {
    const child = (value as Record<PropertyKey, unknown>)[key]
    if (child !== null && typeof child === 'object') {
      deepFreeze(child)
    }
  }

  return value
}
