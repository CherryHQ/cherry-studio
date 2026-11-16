import { cloneHistoryData } from './cloneHistoryData'

export interface CapturedHistory<T> {
  read(): T
}

const capturedValues = new WeakMap<object, unknown>()

/** Capture an already-owned immutable revision; expose only isolated reads. */
export function captureOwnedHistory<T>(value: T, copy: (value: T) => T = cloneHistoryData): CapturedHistory<T> {
  const captured = { read: () => copy(value) }
  capturedValues.set(captured, value)
  return captured
}

/** Counts queued owned graphs once, excluding the authoritative current baseline. */
export class HistoryRetention {
  private readonly shapes = new WeakMap<object, { bytes: number; children: object[] }>()
  private baseline = new Set<object>()

  setBaseline(value: object): void {
    this.baseline = new Set()
    this.measure([value], this.baseline)
  }

  exceeds(values: readonly object[]): boolean {
    return values.length > 1 && this.measure(values, new Set(), this.baseline) > 16 * 1024 * 1024
  }

  clear(): void {
    this.baseline.clear()
  }

  private shape(value: object): { bytes: number; children: object[] } {
    const cached = this.shapes.get(value)
    if (cached) return cached
    const shape = { bytes: 32, children: [] as object[] }
    const add = (child: unknown) => {
      if (child !== null && typeof child === 'object') shape.children.push(child)
      else shape.bytes += typeof child === 'string' ? child.length * 2 + 16 : 8
    }
    if (capturedValues.has(value)) add(capturedValues.get(value))
    else if (ArrayBuffer.isView(value)) add(value.buffer)
    else if (value instanceof ArrayBuffer) shape.bytes += value.byteLength
    else if (value instanceof Map) {
      for (const [key, child] of value) {
        add(key)
        add(child)
      }
    } else if (value instanceof Set) {
      for (const child of value) add(child)
    } else {
      for (const key of Object.getOwnPropertyNames(value)) {
        shape.bytes += key.length * 2 + 16
        add(Reflect.get(value, key))
      }
    }
    this.shapes.set(value, shape)
    return shape
  }

  private measure(values: readonly object[], seen: Set<object>, excluded?: Set<object>): number {
    const pending = [...values]
    let bytes = 0
    while (pending.length) {
      const value = pending.pop()!
      if (seen.has(value) || excluded?.has(value)) continue
      seen.add(value)
      const shape = this.shape(value)
      bytes += shape.bytes
      for (const child of shape.children) pending.push(child)
    }
    return bytes
  }
}
