import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { cliConfigConnectionMatchesProvider } from '../providerMatching'

// Mirrors the provider-registry seed: chat endpoint at https://aihubmix.com/v1,
// no dedicated google-generate-content endpoint.
const aihubmixProvider = {
  id: 'aihubmix',
  name: 'AiHubMix',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': { baseUrl: 'https://aihubmix.com/v1' }
  }
} as unknown as Provider

const openAIProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpointConfigs: {
    'openai-chat-completions': { baseUrl: 'https://express-ent-admin.cherryin.ai' },
    'openai-responses': { baseUrl: 'https://responses.example.com' }
  }
} as unknown as Provider

const openAIChatProvider = {
  id: 'deepseek-chat',
  name: 'DeepSeek Chat',
  endpointConfigs: {
    'openai-chat-completions': { baseUrl: 'https://express-ent-admin.cherryin.ai' }
  }
} as unknown as Provider

const anthropicProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  endpointConfigs: {
    'anthropic-messages': { baseUrl: 'https://api.anthropic.com' }
  }
} as unknown as Provider

const geminiProvider = {
  id: 'gemini',
  name: 'Gemini',
  endpointConfigs: {
    'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' }
  }
} as unknown as Provider

/** CherryIN/DMXAPI: aggregators allow-listed for Gemini CLI with no dedicated
 * google-generate-content endpoint and no GEMINI_AGGREGATOR_BASE_URLS entry —
 * they proxy every protocol off their default chat endpoint's host. */
const cherryinProvider = {
  id: 'cherryin',
  name: 'CherryIN',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': { baseUrl: 'https://open.cherryin.net' },
    'openai-chat-completions': { baseUrl: 'https://open.cherryin.net' }
  }
} as unknown as Provider

const apiKeys: ApiKeyEntry[] = [{ id: 'k1', key: 'sk-secret', isEnabled: true }]

describe('cliConfigConnectionMatchesProvider', () => {
  it('matches Qwen and Kimi against the formatted OpenAI endpoint', () => {
    for (const cliTool of [CodeCli.QWEN_CODE, CodeCli.KIMI_CODE]) {
      expect(
        cliConfigConnectionMatchesProvider(
          cliTool,
          { baseUrl: 'https://express-ent-admin.cherryin.ai/v1', apiKey: 'sk-secret' },
          openAIChatProvider,
          apiKeys
        )
      ).toBe(true)
    }
  })

  it('matches Codex and OpenCode against formatted /v1 endpoints', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.OPENAI_CODEX,
        { baseUrl: 'https://responses.example.com/v1', apiKey: 'sk-secret' },
        openAIProvider,
        apiKeys
      )
    ).toBe(true)
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.OPEN_CODE,
        { baseUrl: 'https://express-ent-admin.cherryin.ai/v1', apiKey: 'sk-secret' },
        openAIProvider,
        apiKeys
      )
    ).toBe(true)
  })

  it('keeps Claude matching on the raw Anthropic endpoint', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.CLAUDE_CODE,
        { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-secret' },
        anthropicProvider,
        apiKeys
      )
    ).toBe(false)
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.CLAUDE_CODE,
        { baseUrl: 'https://api.anthropic.com', apiKey: 'sk-secret' },
        anthropicProvider,
        apiKeys
      )
    ).toBe(true)
  })

  it('keeps Gemini matching on the resolved Gemini endpoint', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://generativelanguage.googleapis.com/v1', apiKey: 'sk-secret' },
        geminiProvider,
        apiKeys
      )
    ).toBe(false)
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'sk-secret' },
        geminiProvider,
        apiKeys
      )
    ).toBe(true)
  })

  it('accepts a Gemini aggregator provider when the config uses its resolved Gemini base URL', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://aihubmix.com/gemini' },
        aihubmixProvider,
        apiKeys
      )
    ).toBe(true)
  })

  it('follows a custom-configured aihubmix host instead of the static aihubmix.com default', () => {
    const customHostProvider = {
      ...(aihubmixProvider as unknown as Record<string, unknown>),
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://custom.example.com/v1' } }
    } as unknown as Provider
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://custom.example.com/gemini' },
        customHostProvider,
        apiKeys
      )
    ).toBe(true)
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://aihubmix.com/gemini' },
        customHostProvider,
        apiKeys
      )
    ).toBe(false)
  })

  it('treats missing connection api key as match when provider has keys configured', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://aihubmix.com/gemini' },
        aihubmixProvider,
        apiKeys
      )
    ).toBe(true)
  })

  it('does not treat the same Gemini proxy URL as a match for non-Gemini tools', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.OPENAI_CODEX,
        { baseUrl: 'https://aihubmix.com/gemini' },
        aihubmixProvider,
        apiKeys
      )
    ).toBe(false)
  })

  it('rejects a connection for the same provider when the configured model differs from the expected model', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://aihubmix.com/gemini', apiKey: 'sk-secret', model: 'gemini-2.5-flash' },
        aihubmixProvider,
        apiKeys,
        'gemini-2.5-pro'
      )
    ).toBe(false)
  })

  it('accepts a connection for the same provider when the configured model matches the expected model', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://aihubmix.com/gemini', apiKey: 'sk-secret', model: 'gemini-2.5-pro' },
        aihubmixProvider,
        apiKeys,
        'gemini-2.5-pro'
      )
    ).toBe(true)
  })

  it('matches a CherryIN-style aggregator with no dedicated Gemini endpoint against its default-chat-endpoint host', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.GEMINI_CLI,
        { baseUrl: 'https://open.cherryin.net', apiKey: 'sk-secret' },
        cherryinProvider,
        apiKeys
      )
    ).toBe(true)
  })

  it('rejects a connection for the same provider when the configured api key differs', () => {
    expect(
      cliConfigConnectionMatchesProvider(
        CodeCli.QWEN_CODE,
        { baseUrl: 'https://express-ent-admin.cherryin.ai/v1', apiKey: 'sk-other' },
        openAIProvider,
        apiKeys
      )
    ).toBe(false)
  })
})
