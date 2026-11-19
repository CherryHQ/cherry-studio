import { parse, stringify } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import {
  buildCodexConfig,
  buildHermesEnvConfig,
  buildOpenCodeConfig,
  buildPiModelsConfig,
  buildPiSettingsConfig,
  buildQwenConfig
} from '../builders'

describe('buildCodexConfig token limits', () => {
  const resolved = { baseUrl: 'https://example.test/v1', providerName: 'Example', model: 'large-model' }

  it.each([1000000, 10000000, Number.MAX_SAFE_INTEGER])('writes metadata capacity %s losslessly', (capacity) => {
    const existing = {
      model_context_window: 800000,
      model_auto_compact_token_limit: 900000,
      user_key: 'keep',
      model_providers: { user: { base_url: 'https://user.test' } }
    }
    const result = buildCodexConfig(existing, resolved, { contextWindow: capacity })
    expect(parse(stringify(result)).model_context_window).toBe(capacity)
    expect(result.model_auto_compact_token_limit).toBe(900000)
    expect(result.user_key).toBe('keep')
    expect(result.model_providers.user.base_url).toBe('https://user.test')
    expect(existing.model_context_window).toBe(800000)
  })

  it.each([undefined, null, 0, -1, 1.5, '1000000', true, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'falls back for invalid metadata %s',
    (capacity) => {
      const result = buildCodexConfig(
        { model_context_window: 800000, model_auto_compact_token_limit: 900000 },
        resolved,
        { contextWindow: capacity }
      )
      expect(result.model_context_window).toBe(800000)
      expect(result.model_auto_compact_token_limit).toBe(900000)
      const fresh = buildCodexConfig({}, resolved, { contextWindow: capacity })
      expect(fresh).not.toHaveProperty('model_context_window')
      expect(fresh).not.toHaveProperty('model_auto_compact_token_limit')
    }
  )

  it.each([0, -1, 1.5, '900000', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'omits invalid existing limits %s independently',
    (value) => {
      const result = buildCodexConfig(
        { model_context_window: value, model_auto_compact_token_limit: value },
        resolved,
        {}
      )
      expect(result).not.toHaveProperty('model_context_window')
      expect(result).not.toHaveProperty('model_auto_compact_token_limit')
    }
  )
})

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

describe('Hermes config builders', () => {
  it('replaces only the Cherry-owned Hermes credential in the environment file', () => {
    expect([
      ...buildHermesEnvConfig(
        new Map([
          ['USER_KEY', 'keep'],
          ['CHERRY_HERMES_API_KEY', 'old']
        ]),
        'sk-secret'
      )
    ]).toEqual([
      ['USER_KEY', 'keep'],
      ['CHERRY_HERMES_API_KEY', 'sk-secret']
    ])
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
