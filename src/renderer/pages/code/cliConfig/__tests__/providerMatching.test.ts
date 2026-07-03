import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { cliConfigConnectionMatchesProvider } from '../providerMatching'

const aihubmixProvider = {
  id: 'aihubmix',
  name: 'AiHubMix',
  endpointConfigs: {
    'openai-chat-completions': { baseUrl: 'https://aihubmix.com' }
  }
} as unknown as Provider

const apiKeys: ApiKeyEntry[] = [{ id: 'k1', key: 'sk-secret', isEnabled: true }]

describe('cliConfigConnectionMatchesProvider', () => {
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
})
