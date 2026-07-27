import { describe, expect, it } from 'vitest'

import {
  type McpServerCapabilityInput,
  sanitizeAgentAutomation,
  sanitizeAgentChannelCapability,
  sanitizeMcpServerCapability,
  sanitizePermissionMode
} from '../capabilityReset'

function mcpInput(overrides: Partial<McpServerCapabilityInput> = {}): McpServerCapabilityInput {
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

/** The executable/network capability columns cleared only when failing closed. */
const CAPABILITY_COLUMNS = ['command', 'args', 'env', 'baseUrl', 'headers', 'configSample'] as const

describe('sanitizeMcpServerCapability — well-formed rows', () => {
  it('resets activity and trust and clears dxtPath, preserving the configuration', () => {
    const result = sanitizeMcpServerCapability(mcpInput())
    expect(result.malformedFields).toEqual([])
    expect(result.patch).toEqual({ isActive: false, isTrusted: null, trustedAt: null, dxtPath: null })
  })

  it('leaves the executable capability untouched when nothing is malformed', () => {
    const { patch } = sanitizeMcpServerCapability(mcpInput())
    for (const column of CAPABILITY_COLUMNS) {
      expect(patch).not.toHaveProperty(column)
    }
  })

  it('accepts unset (NULL) JSON columns as legitimate', () => {
    const result = sanitizeMcpServerCapability({
      args: null,
      env: null,
      headers: null,
      configSample: null,
      disabledTools: null,
      disabledAutoApproveTools: null
    })
    expect(result.malformedFields).toEqual([])
    expect(result.patch).toEqual({ isActive: false, isTrusted: null, trustedAt: null, dxtPath: null })
  })

  it('accepts a configSample without the optional env', () => {
    const result = sanitizeMcpServerCapability(mcpInput({ configSample: { command: 'npx', args: [] } }))
    expect(result.malformedFields).toEqual([])
  })
})

describe('sanitizeMcpServerCapability — malformed capability JSON fails closed', () => {
  it.each([
    ['args as an object', { args: { 0: '--stdio' } }, 'args'],
    ['args holding a non-string', { args: ['ok', 7] }, 'args'],
    ['env holding a nested object', { env: { A: { nested: true } } }, 'env'],
    ['env as an array', { env: ['A=b'] }, 'env'],
    ['headers holding a number', { headers: { 'X-Retry': 3 } }, 'headers'],
    ['configSample missing command', { configSample: { args: [] } }, 'configSample'],
    ['configSample with a non-string command', { configSample: { command: 12, args: [] } }, 'configSample'],
    ['configSample as a string', { configSample: 'npx -y pkg' }, 'configSample'],
    ['disabledTools as a string', { disabledTools: 'all' }, 'disabledTools'],
    ['disabledAutoApproveTools as an object', { disabledAutoApproveTools: {} }, 'disabledAutoApproveTools']
  ])('flags %s', (_label, overrides, field) => {
    const result = sanitizeMcpServerCapability(mcpInput(overrides as Partial<McpServerCapabilityInput>))
    expect(result.malformedFields).toContain(field)
  })

  it('clears the whole executable and network capability on any malformed field', () => {
    const { patch } = sanitizeMcpServerCapability(mcpInput({ args: 'not-an-array' }))
    expect(patch).toEqual({
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

  it('NEVER clears the disabled-tool restriction lists', () => {
    // Clearing a deny list would WIDEN what a re-activated server may do, so the
    // fail-closed action removes the capability instead.
    const { patch } = sanitizeMcpServerCapability(mcpInput({ disabledAutoApproveTools: 'oops' }))
    expect(patch).not.toHaveProperty('disabledTools')
    expect(patch).not.toHaveProperty('disabledAutoApproveTools')
    expect(patch.command).toBeNull()
  })

  it('reports every malformed field, not just the first', () => {
    const result = sanitizeMcpServerCapability(mcpInput({ args: 1, env: 2, headers: 3 }))
    expect(result.malformedFields).toEqual(['args', 'env', 'headers'])
  })
})

describe('sanitizePermissionMode', () => {
  it('drops bypassPermissions', () => {
    expect(sanitizePermissionMode('bypassPermissions')).toBeNull()
  })

  it.each(['default', 'acceptEdits', 'plan'])('keeps the known non-bypassing mode %s', (mode) => {
    expect(sanitizePermissionMode(mode)).toBe(mode)
  })

  it.each([
    ['an unknown string', 'superuser'],
    ['a differently-cased bypass', 'BYPASSPERMISSIONS'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { mode: 'plan' }]
  ])('falls back to null for %s', (_label, value) => {
    expect(sanitizePermissionMode(value)).toBeNull()
  })
})

describe('sanitizeAgentAutomation', () => {
  it('writes heartbeat_enabled false even when the key was absent', () => {
    // The reader is opt-OUT: an absent key means the heartbeat RUNS.
    const { patch } = sanitizeAgentAutomation({ avatar: 'x' })
    expect(patch.configuration.heartbeat_enabled).toBe(false)
    expect(patch.configuration.scheduler_enabled).toBe(false)
  })

  it('overrides an explicitly enabled heartbeat', () => {
    const { patch } = sanitizeAgentAutomation({ heartbeat_enabled: true, heartbeat_interval: 3600 })
    expect(patch.configuration.heartbeat_enabled).toBe(false)
    expect(patch.configuration.heartbeat_interval).toBe(3600)
  })

  it('preserves configuration, env_vars, and unknown keys', () => {
    const { patch } = sanitizeAgentAutomation({
      avatar: 'a.png',
      max_turns: 12,
      env_vars: { PATH_HINT: '/Users/alice/bin' },
      slash_commands: ['/go'],
      builtin_role: 'assistant',
      bootstrap_completed: true,
      future_key: { anything: 1 }
    })
    expect(patch.configuration).toMatchObject({
      avatar: 'a.png',
      max_turns: 12,
      // An absolute producer path inside env_vars stays inert; it is NOT rebased.
      env_vars: { PATH_HINT: '/Users/alice/bin' },
      slash_commands: ['/go'],
      builtin_role: 'assistant',
      bootstrap_completed: true,
      future_key: { anything: 1 }
    })
  })

  it('drops a bypassPermissions permission_mode but keeps other modes', () => {
    expect(sanitizeAgentAutomation({ permission_mode: 'bypassPermissions' }).patch.configuration).not.toHaveProperty(
      'permission_mode'
    )
    expect(sanitizeAgentAutomation({ permission_mode: 'plan' }).patch.configuration.permission_mode).toBe('plan')
  })

  it('fails closed on a known key with the wrong type', () => {
    const result = sanitizeAgentAutomation({ heartbeat_enabled: 'yes', avatar: 'keep.png' })
    expect(result.malformedFields).toContain('heartbeat_enabled')
    expect(result.patch.configuration.heartbeat_enabled).toBe(false)
    expect(result.patch.configuration.avatar).toBe('keep.png')
  })

  it.each([
    ['a string', 'nope'],
    ['an array', ['nope']],
    ['a number', 7]
  ])('resets to an empty configuration when the root is %s', (_label, raw) => {
    const result = sanitizeAgentAutomation(raw)
    expect(result.patch.configuration).toEqual({})
    expect(result.malformedFields).toEqual(['<root>'])
  })

  it('treats an absent configuration as unset rather than malformed', () => {
    const result = sanitizeAgentAutomation(null)
    expect(result.patch.configuration).toEqual({})
    expect(result.malformedFields).toEqual([])
  })
})

describe('sanitizeAgentChannelCapability', () => {
  it('deactivates the channel and clears the proactive notify list', () => {
    const result = sanitizeAgentChannelCapability({
      config: { botToken: 'secret', allowed_chat_ids: [1] },
      permissionMode: 'acceptEdits'
    })
    expect(result.patch).toEqual({ isActive: false, activeChatIds: [], permissionMode: 'acceptEdits' })
    expect(result.malformedFields).toEqual([])
  })

  it('drops a bypassPermissions mode', () => {
    const result = sanitizeAgentChannelCapability({ config: {}, permissionMode: 'bypassPermissions' })
    expect(result.patch.permissionMode).toBeNull()
  })

  it.each([
    ['a string', 'token'],
    ['an array', []],
    ['null', null]
  ])('reports a malformed config that is %s without destroying it', (_label, config) => {
    const result = sanitizeAgentChannelCapability({ config, permissionMode: null })
    expect(result.malformedFields).toEqual(['config'])
    // `isActive: false` already makes the row inert and re-activation re-validates
    // the config, so a bot token is never destroyed to "fail closed".
    expect(result.patch).not.toHaveProperty('config')
    expect(result.patch.isActive).toBe(false)
  })
})
