import type { PlainObject } from '../types'

export const isPlainObject = (value: unknown): value is PlainObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMergeObjects<T extends PlainObject>(target: T, source: PlainObject): T {
  const result: PlainObject = { ...target }
  Object.entries(source).forEach(([key, value]) => {
    const previous = Object.hasOwn(result, key) ? result[key] : undefined
    const merged = isPlainObject(value) && isPlainObject(previous) ? deepMergeObjects(previous, value) : value
    Object.defineProperty(result, key, { value: merged, enumerable: true, writable: true, configurable: true })
  })
  return result as T
}
