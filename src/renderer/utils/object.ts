/**
 * Returns the keys of an object in a type-safe way.
 * @param obj - the object to read keys from
 * @returns an array of the object's keys, typed as the union of its key names
 * @example
 * ```ts
 * const obj = { foo: 1, bar: 'hello' }
 * const keys = objectKeys(obj) // ['foo', 'bar']
 * ```
 */
export function objectKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[]
}

/**
 * Returns the values of an object in a type-safe way.
 * @param obj - the object to read values from
 * @returns an array of the object's values
 * @example
 * const obj = { a: 1, b: 2 } as const
 * const values = objectValues(obj) // (1 | 2)[]
 */
export function objectValues<T extends Record<string, unknown>>(obj: T): T[keyof T][] {
  return Object.values(obj) as T[keyof T][]
}

/**
 * Removes the given keys from an object and returns a new object.
 * @param obj - the source object
 * @param keys - the keys to remove
 * @returns a new object without the specified keys
 * @example
 * ```ts
 * const obj = { a: 1, b: 2, c: 3 }
 * const result = strip(obj, ['a', 'b']) // { c: 3 }
 * ```
 */
export function strip<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete (result as any)[key] // Omit already guarantees type safety
  }
  return result
}
