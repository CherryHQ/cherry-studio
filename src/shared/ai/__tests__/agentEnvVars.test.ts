import { describe, expect, it } from 'vitest'

import { getIgnoredAgentEnvVarKeys, isAgentEnvVarBlocked } from '../agentEnvVars'

describe('agent environment policy', () => {
  it('blocks shared and runtime-specific names case insensitively without namespace bans', () => {
    for (const runtime of ['pi', 'claude-code'] as const) {
      for (const key of ['node_options', 'electron_run_as_node', '__proto__'])
        expect(isAgentEnvVarBlocked(runtime, key)).toBe(true)
      for (const key of ['PI_CUSTOM_NAME', 'CLAUDE_CUSTOM_NAME', 'ELECTRON_CUSTOM_NAME'])
        expect(isAgentEnvVarBlocked(runtime, key)).toBe(false)
    }
    expect(isAgentEnvVarBlocked('pi', 'pi_model')).toBe(true)
    expect(isAgentEnvVarBlocked('claude-code', 'pi_model')).toBe(false)
    expect(isAgentEnvVarBlocked('claude-code', 'anthropic_model')).toBe(true)
    expect(isAgentEnvVarBlocked('pi', 'anthropic_model')).toBe(false)
    expect(isAgentEnvVarBlocked('pi-durable', 'anything')).toBe(true)
  })
  it('classifies every reserved name for the intended runtime', () => {
    const shared = [
      'NODE_OPTIONS',
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_NO_ATTACH_CONSOLE',
      'CHERRY_STUDIO_NODE_PROXY_RULES',
      'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
      'CHERRY_STUDIO_BUN_PATH',
      'CHERRY_STUDIO_SKILLS_DIR',
      '__PROTO__',
      'CONSTRUCTOR',
      'PROTOTYPE'
    ]
    const claude = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'CLAUDE_CONFIG_DIR',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_GIT_BASH_PATH',
      'ENABLE_TOOL_SEARCH',
      'CLAUDE_AGENT_SDK_CLIENT_APP'
    ]
    const pi = ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL']
    for (const key of shared)
      for (const runtime of ['pi', 'claude-code'] as const)
        expect(isAgentEnvVarBlocked(runtime, key.toLowerCase())).toBe(true)
    for (const key of claude) {
      expect(isAgentEnvVarBlocked('claude-code', key.toLowerCase())).toBe(true)
      expect(isAgentEnvVarBlocked('pi', key)).toBe(false)
    }
    for (const key of pi) {
      expect(isAgentEnvVarBlocked('pi', key.toLowerCase())).toBe(true)
      expect(isAgentEnvVarBlocked('claude-code', key)).toBe(false)
    }
  })
  it('reports exact-case external CLI removals in input order without duplicates', () => {
    const keys = [
      'anthropic_custom_headers',
      'ANTHROPIC_CUSTOM_HEADERS',
      'NODE_OPTIONS',
      'ANTHROPIC_CUSTOM_HEADERS',
      'CLAUDE_CODE_OAUTH_TOKEN'
    ]
    expect(getIgnoredAgentEnvVarKeys('claude-code', keys, true)).toEqual([
      'ANTHROPIC_CUSTOM_HEADERS',
      'NODE_OPTIONS',
      'CLAUDE_CODE_OAUTH_TOKEN'
    ])
    expect(getIgnoredAgentEnvVarKeys('claude-code', keys, false)).toEqual(['NODE_OPTIONS'])
    expect(getIgnoredAgentEnvVarKeys('pi-durable', ['a', 'b', 'a'], false)).toEqual(['a', 'b'])
  })
})
