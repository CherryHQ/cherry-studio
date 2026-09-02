import { describe, expect, it } from 'vitest'

import { defineUtilityProcess } from '../defineUtilityProcess'
import type { UtilityProcessContract, UtilityProcessMethod } from '../types'

type EchoContract = UtilityProcessContract & {
  methods: { echo: UtilityProcessMethod<string, string> }
}

const valid = { id: 'test.echo', entry: 'test-echo', cancellation: 'cooperative' as const }

describe('defineUtilityProcess', () => {
  it('returns a frozen definition that keeps the declared fields', () => {
    const definition = defineUtilityProcess<EchoContract>({ ...valid, idleTimeoutMs: 60_000 })

    expect(Object.isFrozen(definition)).toBe(true)
    expect(definition).toMatchObject({ ...valid, idleTimeoutMs: 60_000 })
  })

  it.each([
    ['uppercase', 'Test.echo'],
    ['leading digit', '1test.echo'],
    ['no namespace', 'echo'],
    ['trailing dot', 'test.'],
    ['dash', 'test.my-echo']
  ])('rejects an id with %s', (_label, id) => {
    expect(() => defineUtilityProcess<EchoContract>({ ...valid, id })).toThrow(TypeError)
  })

  it.each([
    ['camelCase', 'testEcho'],
    ['path separator', 'entries/echo'],
    ['extension', 'echo.js'],
    ['empty', '']
  ])('rejects an entry key that is %s', (_label, entry) => {
    expect(() => defineUtilityProcess<EchoContract>({ ...valid, entry })).toThrow(TypeError)
  })

  it('rejects an unknown cancellation mode', () => {
    expect(() => defineUtilityProcess<EchoContract>({ ...valid, cancellation: 'kill' as never })).toThrow(TypeError)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects idleTimeoutMs=%s', (idleTimeoutMs) => {
    expect(() => defineUtilityProcess<EchoContract>({ ...valid, idleTimeoutMs })).toThrow(TypeError)
  })
})
