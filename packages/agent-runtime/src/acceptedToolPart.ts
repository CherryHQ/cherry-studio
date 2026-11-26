import type { RuntimeMessage } from './contracts'
import { immutable } from './immutable'

const immutableOutputs = new WeakSet<object>()
const acceptedToolParts = new WeakSet<object>()

export function isAcceptedToolPart(value: unknown): boolean {
  return typeof value === 'object' && value !== null && acceptedToolParts.has(value)
}

/** Establishes immutable part ownership after adapter decoration, including primitive result values. */
export function snapshotToolPart<T extends RuntimeMessage['parts'][number]>(part: T): T {
  if (isAcceptedToolPart(part)) return part
  const accepted = immutable(part)
  if (freezeOutput(accepted)) acceptedToolParts.add(accepted)
  return accepted
}

function freezeOutput(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || immutableOutputs.has(value) || seen.has(value)) return true
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false
  seen.add(value)
  const children = Object.values(value).map((item) => freezeOutput(item, seen))
  if (!children.every(Boolean)) return false
  Object.freeze(value)
  immutableOutputs.add(value)
  return true
}

/** Copies delivery containers while sharing only deeply frozen, accepted JSON tool payloads. */
export function cloneObservationValue<T>(value: T): T {
  const copies = new WeakMap<object, object>()
  const clone = (item: unknown): unknown => {
    // oxlint-disable-next-line no-restricted-globals -- Preserve native rejection of unsupported values at acceptance.
    if (typeof item === 'function' || typeof item === 'symbol') return structuredClone(item)
    if (typeof item !== 'object' || item === null || immutableOutputs.has(item)) return item
    const known = copies.get(item)
    if (known) return known
    if (Array.isArray(item)) {
      const result: unknown[] = []
      copies.set(item, result)
      for (const child of item) result.push(clone(child))
      return result
    }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      // oxlint-disable-next-line no-restricted-globals -- Non-JSON native payloads require the platform clone at acceptance.
      return structuredClone(item)
    const result: Record<string, unknown> = {}
    copies.set(item, result)
    for (const [key, child] of Object.entries(item))
      Object.defineProperty(result, key, { value: clone(child), enumerable: true, writable: true, configurable: true })
    return result
  }
  return clone(value) as T
}
