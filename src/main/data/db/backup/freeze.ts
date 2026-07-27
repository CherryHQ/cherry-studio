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
 * untouched to avoid corrupting runtime semantics. Cycles AND externally pre-frozen
 * objects are tolerated via a WeakSet visited guard: an already-visited object is
 * not re-descended, but its children are still frozen on first encounter (unlike
 * an Object.isFrozen guard, which would skip the children of a pre-frozen root).
 */
export function deepFreeze<T>(value: T, visited: WeakSet<object> = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return value
  }

  // Skip non-plain objects: freezing a Date/Map/Set/class instance would break its
  // internal slots. Contributor facts are plain object graphs.
  const proto = Object.getPrototypeOf(value)
  const isPlain = Array.isArray(value) || proto === Object.prototype || proto === null
  if (!isPlain) {
    return value
  }

  // Cycle + pre-frozen guard: a visited object is not re-descended. WeakSet (not
  // Object.isFrozen) so children of an externally pre-frozen root still get frozen
  // on the first visit.
  if (visited.has(value as object)) {
    return value
  }
  visited.add(value as object)

  Object.freeze(value)

  // Reflect.ownKeys covers string + symbol keys (skip inherited).
  for (const key of Reflect.ownKeys(value as object)) {
    const child = (value as Record<PropertyKey, unknown>)[key]
    if (child !== null && typeof child === 'object') {
      deepFreeze(child, visited)
    }
  }

  return value
}
