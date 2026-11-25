import type { PlainObject } from '../types'

export const isPlainObject = (value: unknown): value is PlainObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMergeObjects(target: PlainObject, source: PlainObject): PlainObject {
  const result: PlainObject = { ...target }
  Object.entries(source).forEach(([key, value]) => {
    const previous = Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined
    const merged = isPlainObject(value) && isPlainObject(previous) ? deepMergeObjects(previous, value) : value
    Object.defineProperty(result, key, { value: merged, enumerable: true, writable: true, configurable: true })
  })

  return result
}
