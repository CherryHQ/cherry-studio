import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  type McpServerCapabilityInput,
  type McpServerCapabilityMalformedField,
  sanitizeMcpServerCapability
} from '../portableProfilePolicy'

function input(overrides: Partial<McpServerCapabilityInput> = {}): McpServerCapabilityInput {
  return {
    args: ['--stdio'],
    env: { TOKEN: 'abc' },
    headers: { Authorization: 'Bearer x' },
    configSample: { command: 'npx', args: ['-y', 'pkg'], env: { A: 'b' } },
    disabledTools: ['dangerous'],
    disabledAutoApproveTools: ['write_file'],
    ...overrides
  }
}

describe('sanitizeMcpServerCapability', () => {
  it('exposes a schema-compatible inert patch and typed malformed fields', () => {
    const result = sanitizeMcpServerCapability(input())
    expectTypeOf(result.patch.isActive).toEqualTypeOf<false>()
    expectTypeOf(result.patch.isTrusted).toEqualTypeOf<null>()
    expectTypeOf(result.patch.dxtPath).toEqualTypeOf<null>()
    expectTypeOf(result.malformedFields).toEqualTypeOf<readonly McpServerCapabilityMalformedField[]>()
  })

  it('deactivates, clears target trust, and drops the device-local DXT path', () => {
    expect(sanitizeMcpServerCapability(input())).toEqual({
      patch: { isActive: false, isTrusted: null, trustedAt: null, dxtPath: null },
      malformedFields: []
    })
  })

  it('accepts nullable JSON fields as unset', () => {
    expect(
      sanitizeMcpServerCapability({
        args: null,
        env: null,
        headers: null,
        configSample: null,
        disabledTools: null,
        disabledAutoApproveTools: null
      }).malformedFields
    ).toEqual([])
  })

  it('accepts a config sample without its optional env', () => {
    expect(sanitizeMcpServerCapability(input({ configSample: { command: 'npx', args: [] } })).malformedFields).toEqual(
      []
    )
  })

  it.each([
    ['args', { args: 'not-an-array' }],
    ['args', { args: ['ok', 7] }],
    ['env', { env: { A: { nested: true } } }],
    ['env', { env: ['A=b'] }],
    ['headers', { headers: { Retry: 3 } }],
    ['configSample', { configSample: { args: [] } }],
    ['configSample', { configSample: { command: 12, args: [] } }],
    ['configSample', { configSample: 'npx -y pkg' }],
    ['disabledTools', { disabledTools: 'all' }],
    ['disabledAutoApproveTools', { disabledAutoApproveTools: {} }]
  ])('reports malformed %s and fails executable/network capability closed', (field, overrides) => {
    const result = sanitizeMcpServerCapability(input(overrides))
    expect(result.malformedFields).toContain(field)
    expect(result.patch).toMatchObject({
      isActive: false,
      command: null,
      args: null,
      env: null,
      baseUrl: null,
      headers: null,
      configSample: null
    })
  })

  it('clears the complete executable and network capability on any malformed field', () => {
    expect(sanitizeMcpServerCapability(input({ args: 'bad' })).patch).toEqual({
      isActive: false,
      isTrusted: null,
      trustedAt: null,
      dxtPath: null,
      command: null,
      args: null,
      env: null,
      baseUrl: null,
      headers: null,
      configSample: null
    })
  })

  it('never clears restriction lists when another field is malformed', () => {
    const { patch } = sanitizeMcpServerCapability(input({ args: 'bad' }))
    expect(patch).not.toHaveProperty('disabledTools')
    expect(patch).not.toHaveProperty('disabledAutoApproveTools')
  })

  it('reports every malformed field, not only the first', () => {
    expect(sanitizeMcpServerCapability(input({ args: 1, env: 2, headers: 3 })).malformedFields).toEqual([
      'args',
      'env',
      'headers'
    ])
  })
})
