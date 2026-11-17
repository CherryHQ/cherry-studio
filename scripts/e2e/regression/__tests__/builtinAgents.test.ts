import { describe, expect, it } from 'vitest'

import { type BuiltinAssistantAgentIdentity, resolveBuiltinAssistantAgent } from '../builtinAgents'

describe('resolveBuiltinAssistantAgent', () => {
  it.each([
    ['Cherry 小助手', { id: 'builtin-assistant', name: 'Cherry 小助手' }],
    ['Cherry Assistant', { id: 'builtin-assistant', name: 'Cherry Assistant' }],
    ['Renamed 🍒 helper', { id: 'builtin-assistant', name: 'Renamed 🍒 helper' }]
  ])('resolves the assistant role with display name %s', (name, expected) => {
    expect(
      resolveBuiltinAssistantAgent({
        page: 1,
        total: 1,
        items: [{ id: 'builtin-assistant', name, configuration: { builtin_role: 'assistant' } }]
      })
    ).toEqual(expected)
  })

  const assistant: BuiltinAssistantAgentIdentity = {
    id: 'real-assistant',
    name: 'Cherry Assistant',
    configuration: { builtin_role: 'assistant' }
  }
  const decoy: BuiltinAssistantAgentIdentity = { id: 'decoy', name: 'Cherry Assistant' }

  it.each([
    ['before', [decoy, assistant]],
    ['after', [assistant, decoy]]
  ])('ignores a same-name decoy %s the assistant', (_position, items) => {
    expect(resolveBuiltinAssistantAgent({ page: 1, total: 2, items })).toEqual({
      id: 'real-assistant',
      name: 'Cherry Assistant'
    })
  })

  it('ignores missing configuration, support role, and ordinary agents', () => {
    expect(
      resolveBuiltinAssistantAgent({
        page: 1,
        total: 4,
        items: [
          { id: 'missing-config', name: 'Missing configuration' },
          { id: 'support', name: 'Support', configuration: { builtin_role: 'support' } },
          assistant,
          { id: 'ordinary', name: 'Ordinary agent', configuration: {} }
        ]
      })
    ).toEqual({ id: 'real-assistant', name: 'Cherry Assistant' })
  })

  it('rejects no assistant role even with an English-name decoy', () => {
    expect(() => resolveBuiltinAssistantAgent({ page: 1, total: 1, items: [decoy] })).toThrow(
      'Expected exactly one built-in assistant agent (builtin_role=assistant); found 0'
    )
  })

  it('rejects duplicate assistant roles instead of taking the first', () => {
    expect(() =>
      resolveBuiltinAssistantAgent({
        page: 1,
        total: 2,
        items: [assistant, { ...assistant, id: 'second-assistant', name: 'Another assistant' }]
      })
    ).toThrow('Expected exactly one built-in assistant agent (builtin_role=assistant); found 2')
  })

  it.each([
    ['one assistant', [assistant]],
    ['no assistant', [decoy]]
  ])('rejects an incomplete list with %s before checking identity', (_description, items) => {
    expect(() => resolveBuiltinAssistantAgent({ page: 1, total: 2, items })).toThrow(
      'Expected complete GET /agents page 1 (limit 500); received page 1, 1/2 agents'
    )
  })

  it('rejects page 2 even when all items are present', () => {
    expect(() => resolveBuiltinAssistantAgent({ page: 2, total: 1, items: [assistant] })).toThrow(
      'Expected complete GET /agents page 1 (limit 500); received page 2, 1/1 agents'
    )
  })

  it('rejects totals over 500 even when all items are present', () => {
    const items = [assistant, ...Array.from({ length: 500 }, () => decoy)]
    expect(() => resolveBuiltinAssistantAgent({ page: 1, total: 501, items })).toThrow(
      'Expected complete GET /agents page 1 (limit 500); received page 1, 501/501 agents'
    )
  })

  it('accepts a complete list at the inclusive 500-agent limit', () => {
    const items = [...Array.from({ length: 499 }, () => decoy), assistant]
    expect(resolveBuiltinAssistantAgent({ page: 1, total: 500, items })).toEqual({
      id: 'real-assistant',
      name: 'Cherry Assistant'
    })
  })

  it.each([
    ['id', { ...assistant, id: '' }],
    ['name', { ...assistant, name: '' }]
  ])('rejects an assistant with an empty %s', (_field, agent) => {
    expect(() => resolveBuiltinAssistantAgent({ page: 1, total: 1, items: [agent] })).toThrow(
      'Built-in assistant agent must have non-empty id and name'
    )
  })
})
