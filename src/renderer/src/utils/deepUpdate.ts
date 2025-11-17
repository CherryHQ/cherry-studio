import type { DeepPartial } from 'ai'
import { cloneDeep } from 'lodash'

/**
 * Deeply updates an object, allowing undefined to overwrite existing properties, without using `any`
 * @param target Original object
 * @param update Update object (may contain undefined)
 * @returns New object
 */
export function deepUpdate<T extends object>(target: T, update: DeepPartial<T>): T {
  const result = cloneDeep(target)
  for (const key in update) {
    if (Object.hasOwn(update, key)) {
      // @ts-ignore it's runtime safe
      const prev = result[key]
      const next = update[key]

      if (
        next &&
        typeof next === 'object' &&
        !Array.isArray(next) &&
        prev &&
        typeof prev === 'object' &&
        !Array.isArray(prev)
      ) {
        // @ts-ignore it's runtime safe
        result[key] = deepUpdate(prev, next as any)
      } else {
        // @ts-ignore it's runtime safe
        result[key] = next
      }
    }
  }
  return result
}
