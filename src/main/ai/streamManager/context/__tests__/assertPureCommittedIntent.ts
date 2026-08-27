import { expect } from 'vitest'

export function assertPureCommittedIntent(value: unknown): void {
  const visited = new WeakSet<object>()
  const visit = (current: unknown, path: string): void => {
    expect(typeof current, `${path} must not contain a function`).not.toBe('function')
    if (current === null || typeof current !== 'object') return
    if (visited.has(current)) return
    visited.add(current)

    const prototype = Object.getPrototypeOf(current)
    expect(
      prototype === Object.prototype || prototype === Array.prototype || prototype === null,
      `${path} must contain only plain descriptor data`
    ).toBe(true)
    for (const [key, child] of Object.entries(current)) visit(child, `${path}.${key}`)
  }

  visit(value, 'committedIntent')
}
