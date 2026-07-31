import { describe, expect, it } from 'vitest'

import { mergeUserEnvironmentVariables, withPreferredWindowsShellEnvironment } from '../runtimeEnv'

const MANAGED_SHELL_KEYS = [
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_USE_POWERSHELL_TOOL',
  'POWERSHELL_TELEMETRY_OPTOUT'
] as const

describe('withPreferredWindowsShellEnvironment', () => {
  const staleShellEnv = {
    KeepMe: 'kept',
    claude_code_git_bash_path: 'C:\\stale\\bash.exe',
    ClAuDe_CoDe_UsE_PoWeRsHeLl_ToOl: 'stale',
    powershell_telemetry_optout: 'stale'
  }

  it('prefers Git Bash on Windows and removes all stale managed shell keys case-insensitively', () => {
    const result = withPreferredWindowsShellEnvironment(staleShellEnv, 'C:\\Git\\bin\\bash.exe', true)

    expect(result).toEqual({
      env: {
        KeepMe: 'kept',
        CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe'
      },
      disallowedTools: []
    })
    expect(staleShellEnv).toEqual({
      KeepMe: 'kept',
      claude_code_git_bash_path: 'C:\\stale\\bash.exe',
      ClAuDe_CoDe_UsE_PoWeRsHeLl_ToOl: 'stale',
      powershell_telemetry_optout: 'stale'
    })
  })

  it('falls back to PowerShell on Windows and disallows both Bash tool names', () => {
    const result = withPreferredWindowsShellEnvironment(staleShellEnv, null, true)

    expect(result).toEqual({
      env: {
        KeepMe: 'kept',
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
        POWERSHELL_TELEMETRY_OPTOUT: '1'
      },
      disallowedTools: ['Bash', 'builtin_Bash']
    })
  })

  it.each([null, 'C:\\Git\\bin\\bash.exe'])('leaves shell environment unchanged off Windows for path %s', (path) => {
    const result = withPreferredWindowsShellEnvironment(staleShellEnv, path, false)

    expect(result).toEqual({ env: staleShellEnv, disallowedTools: [] })
    expect(result.env).not.toBe(staleShellEnv)
  })

  it.each(MANAGED_SHELL_KEYS)('does not retain stale %s variants in the Git Bash branch', (key) => {
    const result = withPreferredWindowsShellEnvironment({ [key.toLowerCase()]: 'stale' }, 'valid-bash.exe', true)
    const expectedKeys = key === 'CLAUDE_CODE_GIT_BASH_PATH' ? [key] : []

    expect(Object.keys(result.env).filter((candidate) => candidate.toUpperCase() === key)).toEqual(expectedKeys)
  })
})

describe('mergeUserEnvironmentVariables', () => {
  const proxyKeys = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
    'NO_PROXY',
    'no_proxy',
    'SOCKS_PROXY',
    'socks_proxy',
    'grpc_proxy'
  ] as const

  it.each(proxyKeys)('allows %s to override an existing process value', (key) => {
    const result = mergeUserEnvironmentVariables({ [key]: 'process-value' }, { [key]: 'agent-value' }, false)

    expect(result).toEqual({ env: { [key]: 'agent-value' }, blockedKeys: [] })
  })

  it.each(proxyKeys)('allows %s to be cleared with an empty string', (key) => {
    const result = mergeUserEnvironmentVariables({ [key]: 'process-value' }, { [key]: '' }, false)

    expect(result).toEqual({ env: { [key]: '' }, blockedKeys: [] })
  })

  it.each(proxyKeys)('ignores a non-string override for %s', (key) => {
    const result = mergeUserEnvironmentVariables({ [key]: 'process-value' }, { [key]: null }, false)

    expect(result).toEqual({ env: { [key]: 'process-value' }, blockedKeys: [] })
  })

  it.each([null, undefined, false, 0, '', [], ['value']])('ignores non-object user env input %j', (userEnv) => {
    const env = { KEEP: 'base' }
    const result = mergeUserEnvironmentVariables(env, userEnv, false)

    expect(result).toEqual({ env, blockedKeys: [] })
    expect(result.env).not.toBe(env)
  })

  it.each([undefined, null, false, 1, {}, []])('ignores non-string variable values %j', (value) => {
    const result = mergeUserEnvironmentVariables({ KEEP: 'base' }, { USER_VALUE: value }, false)

    expect(result).toEqual({ env: { KEEP: 'base' }, blockedKeys: [] })
  })

  it.each([
    'ANTHROPIC_API_KEY',
    'anthropic_auth_token',
    'Anthropic_Base_Url',
    'ANTHROPIC_CUSTOM_HEADERS',
    'anthropic_model',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CONFIG_DIR',
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ATTACH_CONSOLE',
    'ENABLE_TOOL_SEARCH',
    'CHERRY_STUDIO_BUN_PATH',
    'CLAUDE_CODE_GIT_BASH_PATH',
    'claude_code_use_powershell_tool',
    'PowerShell_Telemetry_OptOut',
    'CHERRY_STUDIO_NODE_PROXY_RULES',
    'cherry_studio_node_proxy_bypass_rules',
    'bUn_OpTiOnS',
    'node_options',
    '__proto__',
    'constructor',
    'prototype'
  ])('blocks protected key %s case-insensitively', (key) => {
    const result = mergeUserEnvironmentVariables({ KEEP: 'base' }, { [key]: 'override' }, false)

    expect(result).toEqual({ env: { KEEP: 'base' }, blockedKeys: [key] })
  })

  it('returns every blocked key while still merging normal variables', () => {
    const result = mergeUserEnvironmentVariables(
      { KEEP: 'base' },
      {
        ANTHROPIC_API_KEY: 'secret',
        claude_code_git_bash_path: 'bash.exe',
        NODE_OPTIONS: '--require malicious.js',
        USER_SETTING: 'allowed'
      },
      false
    )

    expect(result).toEqual({
      env: { KEEP: 'base', USER_SETTING: 'allowed' },
      blockedKeys: ['ANTHROPIC_API_KEY', 'claude_code_git_bash_path', 'NODE_OPTIONS']
    })
  })

  it('removes inherited BUN_OPTIONS on non-Windows without mutating the input or removing normal variables', () => {
    const env = { BUN_OPTIONS: '--preload=/tmp/injected.js', PATH: '/usr/bin', USER_SETTING: 'kept' }

    const result = mergeUserEnvironmentVariables(env, undefined, false)

    expect(result).toEqual({ env: { PATH: '/usr/bin', USER_SETTING: 'kept' }, blockedKeys: [] })
    expect(env).toEqual({ BUN_OPTIONS: '--preload=/tmp/injected.js', PATH: '/usr/bin', USER_SETTING: 'kept' })
  })

  it('removes every inherited BUN_OPTIONS casing variant on Windows without mutating the input', () => {
    const env = {
      BUN_OPTIONS: '--preload=first.js',
      Bun_Options: '--preload=second.js',
      bun_options: '--preload=third.js',
      PATH: 'C:\\Windows\\System32',
      USER_SETTING: 'kept'
    }

    const result = mergeUserEnvironmentVariables(env, undefined, true)

    expect(result).toEqual({
      env: { PATH: 'C:\\Windows\\System32', USER_SETTING: 'kept' },
      blockedKeys: []
    })
    expect(env).toEqual({
      BUN_OPTIONS: '--preload=first.js',
      Bun_Options: '--preload=second.js',
      bun_options: '--preload=third.js',
      PATH: 'C:\\Windows\\System32',
      USER_SETTING: 'kept'
    })
  })

  it('blocks Agent-provided BUN_OPTIONS in any spelling while preserving normal Agent variables', () => {
    const result = mergeUserEnvironmentVariables(
      { BUN_OPTIONS: '--preload=inherited.js', KEEP: 'base' },
      { bUn_OpTiOnS: '--preload=agent.js', USER_SETTING: 'allowed' },
      false
    )

    expect(result).toEqual({
      env: { KEEP: 'base', USER_SETTING: 'allowed' },
      blockedKeys: ['bUn_OpTiOnS']
    })
  })

  it('deduplicates existing and preceding user keys case-insensitively on Windows with the last user spelling winning', () => {
    const env = { Path: 'base', PATH: 'duplicate-base', Keep: 'value' }
    const result = mergeUserEnvironmentVariables(env, { path: 'first-user', PaTh: 'last-user' }, true)

    expect(result).toEqual({ env: { Keep: 'value', PaTh: 'last-user' }, blockedKeys: [] })
    expect(env).toEqual({ Path: 'base', PATH: 'duplicate-base', Keep: 'value' })
  })

  it('lets a user proxy value replace every differently-cased process proxy key on Windows', () => {
    const result = mergeUserEnvironmentVariables(
      { HTTP_PROXY: 'first-process', Http_Proxy: 'second-process' },
      { http_proxy: 'agent-value' },
      true
    )

    expect(result).toEqual({ env: { http_proxy: 'agent-value' }, blockedKeys: [] })
  })

  it('preserves case-sensitive key semantics on non-Windows platforms', () => {
    const result = mergeUserEnvironmentVariables({ PATH: 'base' }, { Path: 'user' }, false)

    expect(result).toEqual({ env: { PATH: 'base', Path: 'user' }, blockedKeys: [] })
  })
})
