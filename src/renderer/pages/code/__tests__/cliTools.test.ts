import type { Provider } from '@shared/data/types/provider'
import { CodeCli, GATEWAY_CAPABLE_CLI_TOOLS, LOGIN_CAPABLE_CLI_TOOLS } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { CLI_TOOL_PROVIDER_MAP, CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'

describe('CLI_TOOLS', () => {
  it('exposes every CodeCli enum value with a renderable icon component', () => {
    const expectedValues = Object.values(CodeCli)
    const actualValues = CLI_TOOLS.map((tool) => tool.value)

    expect(actualValues.sort()).toEqual([...expectedValues].sort())

    for (const tool of CLI_TOOLS) {
      expect(typeof tool.icon).toBe('function')
    }
  })
})

describe('LOGIN_CAPABLE_CLI_TOOLS', () => {
  it('covers exactly the tools that offer the virtual own-login option', () => {
    expect([...LOGIN_CAPABLE_CLI_TOOLS].sort()).toEqual(
      [
        CodeCli.CLAUDE_CODE,
        CodeCli.OPENAI_CODEX,
        CodeCli.GEMINI_CLI,
        CodeCli.QWEN_CODE,
        CodeCli.KIMI_CODE,
        CodeCli.PI
      ].sort()
    )
  })

  it('never overlaps the fully providerless tools', () => {
    for (const tool of PROVIDERLESS_CLI_TOOLS) {
      expect(LOGIN_CAPABLE_CLI_TOOLS.has(tool)).toBe(false)
    }
  })
})

describe('DeepSeek Harness provider support', () => {
  const provider = (partial: Record<string, unknown>): Provider =>
    ({
      id: 'provider',
      name: 'Provider',
      authType: 'api-key',
      apiKeys: [],
      endpointConfigs: {},
      ...partial
    }) as unknown as Provider

  it('offers the Unified Gateway and providers with usable API-key credentials', () => {
    expect(GATEWAY_CAPABLE_CLI_TOOLS.has(CodeCli.DEEPSEEK_HARNESS)).toBe(true)
    const supported = CLI_TOOL_PROVIDER_MAP[CodeCli.DEEPSEEK_HARNESS]([
      provider({
        id: 'api-key',
        apiKeys: [{ id: 'key', isEnabled: true }],
        defaultChatEndpoint: 'openai-responses',
        endpointConfigs: {
          'openai-responses': { baseUrl: 'https://api.example/v1', dialect: { developerRole: true } }
        }
      }),
      provider({
        id: 'keyless',
        authOptional: true,
        endpointConfigs: { 'anthropic-messages': { baseUrl: 'http://127.0.0.1:11434' } }
      }),
      provider({
        id: 'missing-key',
        endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://api.example/v1' } }
      }),
      provider({
        id: 'oauth-with-api-key',
        authType: 'oauth',
        apiKeys: [{ id: 'key', isEnabled: true }],
        endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.example' } }
      }),
      provider({
        id: 'oauth-only',
        authType: 'oauth',
        authMethods: ['oauth'],
        authOptional: true,
        apiKeys: [{ id: 'stale-key', isEnabled: true }],
        endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.example' } }
      }),
      provider({
        id: 'gemini-only',
        apiKeys: [{ id: 'key', isEnabled: true }],
        endpointConfigs: { 'google-generate-content': { baseUrl: 'https://google.example' } }
      })
    ])

    expect(supported.map((item) => item.id)).toEqual(['api-key', 'keyless', 'oauth-with-api-key'])
  })

  it('excludes providers without developer role and without an Anthropic fallback', () => {
    const supported = CLI_TOOL_PROVIDER_MAP[CodeCli.DEEPSEEK_HARNESS]([
      provider({
        id: 'openai-only-no-developer-role',
        apiKeys: [{ id: 'key', isEnabled: true }],
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://api.example/v1' } }
      }),
      provider({
        id: 'openai-only-with-developer-role',
        apiKeys: [{ id: 'key', isEnabled: true }],
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://api.example/v1', dialect: { developerRole: true } }
        }
      }),
      provider({
        id: 'no-developer-role-but-has-anthropic-fallback',
        apiKeys: [{ id: 'key', isEnabled: true }],
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://api.example/v1' },
          'anthropic-messages': { baseUrl: 'https://api.example/anthropic' }
        }
      })
    ])

    expect(supported.map((item) => item.id)).toEqual([
      'openai-only-with-developer-role',
      'no-developer-role-but-has-anthropic-fallback'
    ])
  })
})
