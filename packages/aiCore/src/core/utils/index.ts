import type { PlainObject } from '../types'

export const isPlainObject = (value: unknown): value is PlainObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMergeObjects<T extends PlainObject>(target: T, source: PlainObject): T {
  const result: PlainObject = { ...target }
  Object.entries(source).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMergeObjects(result[key], value)
    } else {
      result[key] = value
    }
  })
  return result as T
}
