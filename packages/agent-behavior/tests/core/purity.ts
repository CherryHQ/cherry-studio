import { vi } from 'vitest'

const touched = (name: string) => () => {
  throw new Error(`core touched ${name}`)
}

/** Runs `run` with the clock, randomness and UUIDs made to throw, so code under test that reads them fails. */
export function withoutEnvironment<T>(run: () => T): T {
  const spies = [
    vi.spyOn(Date, 'now').mockImplementation(touched('Date.now')),
    vi.spyOn(Math, 'random').mockImplementation(touched('Math.random')),
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(touched('crypto.randomUUID'))
  ]
  try {
    return run()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

/** Freezes `value` and every object or array inside it, so code that mutates its input throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
