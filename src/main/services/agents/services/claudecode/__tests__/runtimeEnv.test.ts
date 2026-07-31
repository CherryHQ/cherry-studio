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

  const scrubbedClaudeEnvKeys = [
    ['Claude_Code_OAuth_Token', 'CLAUDE_CODE_OAUTH_TOKEN'],
    ['claude_code_oauth_token_file_descriptor', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'],
    ['Claude_Code_Use_Vertex', 'CLAUDE_CODE_USE_VERTEX'],
    ['claude_code_use_foundry', 'CLAUDE_CODE_USE_FOUNDRY'],
    ['Claude_Code_Use_Anthropic_Aws', 'CLAUDE_CODE_USE_ANTHROPIC_AWS'],
    ['claude_code_use_gateway', 'CLAUDE_CODE_USE_GATEWAY'],
    ['Claude_Code_Use_Mantle', 'CLAUDE_CODE_USE_MANTLE']
  ] as const

  const scrubbedRemoteEnvKeys = [
    ['Claude_Code_Remote', 'CLAUDE_CODE_REMOTE'],
    ['claude_code_remote_session_id', 'CLAUDE_CODE_REMOTE_SESSION_ID'],
    ['Ccr_Agent_Proxy_Enabled', 'CCR_AGENT_PROXY_ENABLED'],
    ['agent_proxy_url', 'AGENT_PROXY_URL'],
    ['Agent_Proxy_Auth_Token', 'AGENT_PROXY_AUTH_TOKEN'],
    ['claude_session_ingress_token_file', 'CLAUDE_SESSION_INGRESS_TOKEN_FILE'],
    ['Session_Ingress_Url', 'SESSION_INGRESS_URL'],
    ['claude_code_force_bridge', 'CLAUDE_CODE_FORCE_BRIDGE'],
    ['Claude_Bridge_Base_Url', 'CLAUDE_BRIDGE_BASE_URL'],
    ['claude_bridge_oauth_token', 'CLAUDE_BRIDGE_OAUTH_TOKEN'],
    ['Claude_Bridge_Session_Ingress_Url', 'CLAUDE_BRIDGE_SESSION_INGRESS_URL'],
    ['claude_bridge_reattach_session', 'CLAUDE_BRIDGE_REATTACH_SESSION'],
    ['Claude_Code_Use_Ccr_V2', 'CLAUDE_CODE_USE_CCR_V2'],
    ['claude_code_websocket_auth_file_descriptor', 'CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR']
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

  it.each(scrubbedClaudeEnvKeys)(
    'removes inherited Claude authentication/backend variable %s case-insensitively',
    (inheritedKey, canonicalKey) => {
      const env = {
        [inheritedKey]: 'inherited-override',
        ANTHROPIC_AUTH_TOKEN: 'application-token',
        ANTHROPIC_BASE_URL: 'https://application.example.com',
        HTTP_PROXY: 'http://proxy.example.com',
        LOGIN_SHELL_VAR: 'kept'
      }

      const result = mergeUserEnvironmentVariables(env, undefined, false)

      expect(result).toEqual({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'application-token',
          ANTHROPIC_BASE_URL: 'https://application.example.com',
          HTTP_PROXY: 'http://proxy.example.com',
          LOGIN_SHELL_VAR: 'kept'
        },
        blockedKeys: []
      })
      expect(Object.keys(result.env).map((key) => key.toUpperCase())).not.toContain(canonicalKey)
      expect(env).toHaveProperty(inheritedKey, 'inherited-override')
    }
  )

  it.each(scrubbedClaudeEnvKeys)(
    'blocks Agent-provided Claude authentication/backend variable %s case-insensitively',
    (userKey, canonicalKey) => {
      const userEnv = { [userKey]: 'agent-override', AGENT_VAR: 'kept' }

      const result = mergeUserEnvironmentVariables({ BASE_VAR: 'kept' }, userEnv, false)

      expect(result).toEqual({
        env: { BASE_VAR: 'kept', AGENT_VAR: 'kept' },
        blockedKeys: [userKey]
      })
      expect(userKey.toUpperCase()).toBe(canonicalKey)
      expect(userEnv).toEqual({ [userKey]: 'agent-override', AGENT_VAR: 'kept' })
    }
  )

  it('keeps application-provided Claude values while removing inherited Windows casing aliases', () => {
    const env = {
      anthropic_auth_token: 'inherited-token',
      ANTHROPIC_AUTH_TOKEN: 'application-token',
      Anthropic_Base_Url: 'https://inherited.example.com',
      ANTHROPIC_BASE_URL: 'https://application.example.com',
      HTTPS_PROXY: 'http://proxy.example.com',
      LOGIN_SHELL_VAR: 'kept'
    }

    const result = mergeUserEnvironmentVariables(env, undefined, true)

    expect(result).toEqual({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'application-token',
        ANTHROPIC_BASE_URL: 'https://application.example.com',
        HTTPS_PROXY: 'http://proxy.example.com',
        LOGIN_SHELL_VAR: 'kept'
      },
      blockedKeys: []
    })
    expect(env).toHaveProperty('anthropic_auth_token', 'inherited-token')
    expect(env).toHaveProperty('Anthropic_Base_Url', 'https://inherited.example.com')
  })

  it.each(scrubbedRemoteEnvKeys)(
    'removes inherited remote/bridge/agent-proxy variable %s case-insensitively',
    (inheritedKey, canonicalKey) => {
      const env = {
        [inheritedKey]: 'inherited-override',
        ANTHROPIC_AUTH_TOKEN: 'application-token',
        ANTHROPIC_BASE_URL: 'https://application.example.com',
        HTTPS_PROXY: 'http://proxy.example.com',
        LOGIN_SHELL_VAR: 'kept'
      }

      const result = mergeUserEnvironmentVariables(env, undefined, true)

      expect(result).toEqual({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'application-token',
          ANTHROPIC_BASE_URL: 'https://application.example.com',
          HTTPS_PROXY: 'http://proxy.example.com',
          LOGIN_SHELL_VAR: 'kept'
        },
        blockedKeys: []
      })
      expect(Object.keys(result.env).map((key) => key.toUpperCase())).not.toContain(canonicalKey)
      expect(env).toEqual({
        [inheritedKey]: 'inherited-override',
        ANTHROPIC_AUTH_TOKEN: 'application-token',
        ANTHROPIC_BASE_URL: 'https://application.example.com',
        HTTPS_PROXY: 'http://proxy.example.com',
        LOGIN_SHELL_VAR: 'kept'
      })
    }
  )

  it.each(scrubbedRemoteEnvKeys)(
    'blocks Agent-provided remote/bridge/agent-proxy variable %s case-insensitively',
    (userKey, canonicalKey) => {
      const userEnv = { [userKey]: 'agent-override', AGENT_VAR: 'kept' }

      const result = mergeUserEnvironmentVariables(
        { ANTHROPIC_AUTH_TOKEN: 'application-token', BASE_VAR: 'kept' },
        userEnv,
        false
      )

      expect(result).toEqual({
        env: { ANTHROPIC_AUTH_TOKEN: 'application-token', BASE_VAR: 'kept', AGENT_VAR: 'kept' },
        blockedKeys: [userKey]
      })
      expect(userKey.toUpperCase()).toBe(canonicalKey)
      expect(userEnv).toEqual({ [userKey]: 'agent-override', AGENT_VAR: 'kept' })
    }
  )

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
