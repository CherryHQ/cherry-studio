import { describe, expect, it } from 'vitest'

import { buildOpenCodeConfig, buildPiModelsConfig, buildPiSettingsConfig, buildQwenConfig } from '../builders'

describe('buildOpenCodeConfig', () => {
  it('adds string provider headers', () => {
    const result = buildOpenCodeConfig(
      {},
      { id: 'deepseek', name: 'DeepSeek' },
      {
        npm: '@ai-sdk/openai-compatible',
        providerType: 'openai-compatible',
        endpointType: 'openai-chat-completions'
      },
      { apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'deepseek-chat' },
      {
        providerHeaders: { 'X-Title': 'Cherry Studio', invalid: 42 }
      }
    )

    expect(result.provider['cherry-DeepSeek'].options).toEqual({
      apiKey: 'sk-test',
      baseURL: 'https://api.example.com/v1',
      headers: { 'X-Title': 'Cherry Studio' }
    })
  })

  it('adds model context and output limits from model metadata', () => {
    const result = buildOpenCodeConfig(
      {},
      { id: 'deepseek', name: 'DeepSeek' },
      {
        npm: '@ai-sdk/openai-compatible',
        providerType: 'openai-compatible',
        endpointType: 'openai-chat-completions'
      },
      { apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'deepseek-chat' },
      { contextWindow: 65536, maxOutputTokens: 8192 }
    )

    expect(result.provider['cherry-DeepSeek'].models['deepseek-chat'].limit).toEqual({
      context: 65536,
      output: 8192
    })
  })
})

describe('buildQwenConfig', () => {
  const resolved = { apiKey: 'sk-test', baseUrl: 'https://example.com', model: 'qwen-max', modelLabel: 'Qwen Max' }

  // Regression: a hand-edited ~/.qwen/settings.json can have `security` / `modelProviders` as any
  // JSON type. Spreading a non-object directly (e.g. `{ ...existing.security }` on a string) fans it
  // out by index instead of producing an empty object, silently corrupting the written config.
  it('tolerates a non-object security/auth/modelProviders in the existing config instead of index-spreading it', () => {
    const existing = {
      security: 'not-an-object',
      modelProviders: ['not-an-object-either']
    }

    const result = buildQwenConfig(existing, resolved, {})

    expect(result.security).toEqual({ auth: { selectedType: 'openai' } })
    expect(Array.isArray(result.modelProviders)).toBe(false)
    expect(result.modelProviders.openai).toEqual([
      { id: 'qwen-max', name: 'Qwen Max', baseUrl: 'https://example.com', envKey: 'CHERRY_QWEN_API_KEY' }
    ])
  })

  it('preserves unrelated existing security/auth fields', () => {
    const existing = {
      security: { auth: { someOtherField: 'keep-me' }, unrelated: true }
    }

    const result = buildQwenConfig(existing, resolved, {})

    expect(result.security).toEqual({
      unrelated: true,
      auth: { someOtherField: 'keep-me', selectedType: 'openai' }
    })
  })
})

describe('Pi config builders', () => {
  it('writes one Cherry-managed provider and preserves user providers', () => {
    const result = buildPiModelsConfig(
      {
        userTop: 'keep',
        providers: {
          'cherry-old': { baseUrl: 'https://old.example' },
          user: { baseUrl: 'https://user.example' }
        }
      },
      {
        api: 'openai-completions',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1',
        contextWindow: 128000,
        headers: { 'X-Title': 'Cherry Studio' },
        input: ['text', 'image'],
        maxTokens: 8192,
        model: 'model-id',
        modelLabel: 'Model Label',
        providerKey: 'cherry-example',
        reasoning: true
      }
    )

    expect(result).toEqual({
      userTop: 'keep',
      providers: {
        user: { baseUrl: 'https://user.example' },
        'cherry-example': {
          baseUrl: 'https://api.example.com/v1',
          api: 'openai-completions',
          apiKey: 'sk-test',
          headers: { 'X-Title': 'Cherry Studio' },
          models: [
            {
              id: 'model-id',
              name: 'Model Label',
              reasoning: true,
              input: ['text', 'image'],
              contextWindow: 128000,
              maxTokens: 8192
            }
          ]
        }
      }
    })
  })

  it('sets Pi defaults without dropping unrelated settings', () => {
    expect(buildPiSettingsConfig({ theme: 'light' }, { providerKey: 'cherry-example', model: 'model-id' })).toEqual({
      theme: 'light',
      defaultProvider: 'cherry-example',
      defaultModel: 'model-id'
    })
  })
})
