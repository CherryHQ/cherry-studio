import { describe, expect, it } from 'vitest'

import { REDACTED } from '@shared/utils/redaction'

import { redactToShape } from '../redactToShape'

describe('redactToShape', () => {
  it.each(['tool', 'request', 'response', 'headers'] as const)('hides user-controlled keys in %s payloads', (kind) => {
    const shape = redactToShape({ 'alice@example.com': { 'private diagnosis': 'private result' } }, kind)
    const serialized = JSON.stringify(shape)

    expect(serialized).not.toContain('alice@example.com')
    expect(serialized).not.toContain('private diagnosis')
    expect(serialized).not.toContain('private result')
    expect(serialized).toContain('<string:14>')
  })

  it('does not mistake user keys containing protocol paths for protocol metadata', () => {
    const request = redactToShape(
      { 'tools[].function.name': 'private-name', 'thinking.budget_tokens': 123456 },
      'request'
    )
    const response = redactToShape({ 'error.code': 'private-code' }, 'response')

    expect(JSON.stringify(request)).not.toContain('private-name')
    expect(JSON.stringify(request)).not.toContain('123456')
    expect(JSON.stringify(response)).not.toContain('private-code')
  })

  it('preserves allowlisted request metadata only at protocol paths', () => {
    const shape = redactToShape(
      {
        model: 'gpt-5',
        temperature: 0.7,
        stream: true,
        max_tokens: 4096,
        thinking: { budget_tokens: 1024 },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'private' }] }],
        tools: [{ type: 'function', function: { name: 'search_web', description: 'private description' } }],
        arguments: { model: 'private-model', max_tokens: 123456, role: 'private-role' },
        token: 123456,
        password: false
      },
      'request'
    )

    expect(shape).toMatchObject({
      model: 'gpt-5',
      temperature: 0.7,
      stream: true,
      max_tokens: 4096,
      thinking: { budget_tokens: 1024 },
      messages: [{ role: 'user', content: [{ type: 'text', text: '<string:7>' }] }],
      tools: [{ type: 'function', function: { name: 'search_web', description: '<string:19>' } }]
    })
    expect(JSON.stringify(shape)).not.toMatch(/private|123456/)
  })

  it('hides short and empty user content and every tool argument value', () => {
    const shape = redactToShape({
      content: 'private',
      text: '',
      query: 'medical query',
      path: '/private.txt',
      model: 'private-model',
      role: 'private-role',
      age: 42,
      consent: true,
      nested: ['private result', 123n]
    })

    expect(Object.values(shape as Record<string, unknown>)).toEqual([
      '<string:7>',
      '<string:0>',
      '<string:13>',
      '<string:12>',
      '<string:13>',
      '<string:12>',
      '<number>',
      '<boolean>',
      ['<string:14>', '<bigint>']
    ])
  })

  it.each([123456, false, 123n])('redacts sensitive fields with value %s', (value) => {
    const shape = redactToShape({ password: value, token: value, auth: value }) as Record<string, unknown>
    expect(Object.values(shape)).toEqual([REDACTED, REDACTED, REDACTED])
  })

  it('retains only allowlisted response headers, including token rate limits', () => {
    const shape = redactToShape(
      {
        'content-type': 'application/json',
        'x-ratelimit-remaining-tokens': '1200',
        'retry-after': '30',
        'set-cookie': 'private',
        authorization: 123456,
        'x-custom-header': 'private',
        'x-ratelimit-limit-requests': 'private'
      },
      'headers'
    )
    expect(shape).toMatchObject({
      'content-type': 'application/json',
      'x-ratelimit-remaining-tokens': '1200',
      'retry-after': '30',
      'x-ratelimit-limit-requests': '<string:7>'
    })
    expect(JSON.stringify(shape)).not.toMatch(/private|123456|x-custom-header/)
  })

  it('bounds wide and branching objects, including long property names', () => {
    const wide = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`${i}-${'x'.repeat(1000)}`, 'private']))
    const tree = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`branch${i}`, wide]))

    expect(Buffer.byteLength(JSON.stringify(redactToShape(wide)))).toBeLessThanOrEqual(4096)
    expect(Buffer.byteLength(JSON.stringify(redactToShape(tree)))).toBeLessThanOrEqual(4096)
  })

  it('keeps both ends of message arrays while hiding their content', () => {
    const values = Array.from({ length: 30 }, (_, index) => 'x'.repeat(index))
    expect(redactToShape(values)).toEqual([
      '<string:0>',
      '<string:1>',
      '<string:2>',
      '<string:3>',
      '<22 more items>',
      '<string:26>',
      '<string:27>',
      '<string:28>',
      '<string:29>'
    ])
  })

  it('terminates circular payloads without leaking scalar values', () => {
    const value: Record<string, unknown> = { content: 'private' }
    value.self = value
    const serialized = JSON.stringify(redactToShape(value))
    expect(serialized).toContain('<object>')
    expect(serialized).not.toContain('private')
    expect(serialized.length).toBeLessThan(4096)
  })
})
