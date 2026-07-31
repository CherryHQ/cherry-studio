import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'

import { transformModel, transformProvider } from '../ProviderModelMappings'

describe('ProviderModelMappings', () => {
  describe('transformModel', () => {
    it('drops explicit v1 web-search selection from generic model capabilities', () => {
      const enabled = transformModel(
        {
          id: 'private-model',
          name: 'Private Model',
          capabilities: [
            { type: 'function_calling', isUserSelected: true },
            { type: 'web_search', isUserSelected: true }
          ]
        } as never,
        'custom-provider'
      )
      const disabled = transformModel(
        {
          id: 'private-model',
          capabilities: [{ type: 'web_search', isUserSelected: false }]
        } as never,
        'custom-provider'
      )

      expect(enabled.capabilities).toEqual(['function-call'])
      expect(disabled.capabilities).toEqual([])
    })

    it('leaves inferred v1 web-search entries to the v2 registry default', () => {
      const result = transformModel(
        {
          id: 'claude-sonnet-4-6',
          capabilities: [{ type: 'web_search' }]
        } as never,
        'anthropic'
      )

      expect(result.capabilities).toEqual([])
    })
  })

  describe('transformProvider', () => {
    it('maps custom-id Azure providers to azure-openai preset via type fallback', () => {
      const result = transformProvider(
        {
          id: '42e57799-1f4e-44f7-a6bb-a888ce4ecee0',
          name: 'azure-gpt-4o',
          type: 'azure-openai',
          apiKey: 'k',
          apiHost: 'https://xianyuomar1000.openai.azure.com',
          models: [],
          enabled: true,
          isSystem: false,
          apiVersion: 'preview'
        } as never,
        {}
      )

      expect(result.presetProviderId).toBe('azure-openai')
      expect(result.authConfig).toEqual({ type: 'iam-azure', apiVersion: 'preview' })
    })

    it('migrates VertexAI auth while keeping its generated host as an empty endpoint override', () => {
      const result = transformProvider(
        {
          id: 'vertexai',
          name: 'VertexAI',
          type: 'vertexai',
          apiKey: '',
          apiHost: '',
          models: [],
          enabled: true,
          isSystem: true,
          isVertex: true
        } as never,
        {
          vertexai: {
            projectId: 'project-1',
            location: 'us-central1',
            serviceAccount: {
              privateKey: 'private-key',
              clientEmail: 'client@example.com'
            }
          }
        }
      )

      expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
      expect(result.endpointConfigs).toBeNull()
      expect(result.authConfig).toEqual({
        type: 'iam-gcp',
        project: 'project-1',
        location: 'us-central1',
        credentials: {
          privateKey: 'private-key',
          clientEmail: 'client@example.com'
        }
      })
    })

    it('migrates a custom VertexAI apiHost as an OpenAI-compatible endpoint override', () => {
      const result = transformProvider(
        {
          id: 'vertexai',
          name: 'VertexAI',
          type: 'vertexai',
          apiKey: '',
          apiHost: 'https://vertex-proxy.example.com/v1/projects/project-1/locations/us-central1',
          models: [],
          enabled: true,
          isSystem: true,
          isVertex: true
        } as never,
        {}
      )

      expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
      expect(result.authConfig).toEqual({
        type: 'iam-gcp',
        project: '',
        location: '',
        credentials: undefined
      })
      // adapterFamily is not persisted — read-time inference routes
      // google-generate-content to the google adapter.
      expect(result.endpointConfigs).toEqual({
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          baseUrl: 'https://vertex-proxy.example.com/v1/projects/project-1/locations/us-central1'
        }
      })
    })

    it.each(['https://aiplatform.googleapis.com', 'https://us-central1-aiplatform.googleapis.com'])(
      'drops the official VertexAI host %s instead of migrating it as an override',
      (apiHost) => {
        // v1 rebuilt the resource path from this host per request; carrying it
        // over would persist an override that means "default" and 404 in v2.
        const result = transformProvider(
          {
            id: 'vertexai',
            name: 'VertexAI',
            type: 'vertexai',
            apiKey: '',
            apiHost,
            models: [],
            enabled: true,
            isSystem: true,
            isVertex: true
          } as never,
          {}
        )

        expect(result.endpointConfigs).toBeNull()
      }
    )

    it('migrates Azure OpenAI as an Azure provider with an OpenAI-compatible endpoint', () => {
      const result = transformProvider(
        {
          id: 'azure-openai',
          name: 'Azure OpenAI',
          type: 'azure-openai',
          apiKey: 'azure-key',
          apiHost: 'https://example.openai.azure.com/openai/deployments/deployment-1',
          apiVersion: '2024-10-21',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {}
      )

      expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
      // adapterFamily is not persisted — read-time inference covers it.
      expect(result.endpointConfigs).toEqual({
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://example.openai.azure.com/openai/deployments/deployment-1'
        }
      })
      expect(result.authConfig).toEqual({
        type: 'iam-azure',
        apiVersion: '2024-10-21'
      })
    })

    it('keeps Azure OpenAI identity even when legacy apiVersion is empty', () => {
      const result = transformProvider(
        {
          id: 'azure-openai',
          name: 'Azure OpenAI',
          type: 'azure-openai',
          apiKey: '',
          apiHost: '',
          apiVersion: '',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {}
      )

      expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
      expect(result.authConfig).toEqual({
        type: 'iam-azure',
        apiVersion: ''
      })
    })

    it('migrates AWS Bedrock IAM settings as iam-aws auth', () => {
      const result = transformProvider(
        {
          id: 'aws-bedrock',
          name: 'AWS Bedrock',
          type: 'aws-bedrock',
          apiKey: '',
          apiHost: '',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {
          awsBedrock: {
            authType: 'iam',
            accessKeyId: 'access-key',
            secretAccessKey: 'secret-key',
            region: 'us-east-1'
          }
        }
      )

      expect(result.defaultChatEndpoint).toBeNull()
      expect(result.endpointConfigs).toBeNull()
      expect(result.apiKeys).toEqual([])
      expect(result.authConfig).toEqual({
        type: 'iam-aws',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key'
      })
    })

    it('migrates AWS Bedrock API key mode from legacy settings', () => {
      const result = transformProvider(
        {
          id: 'aws-bedrock',
          name: 'AWS Bedrock',
          type: 'aws-bedrock',
          apiKey: 'legacy-bedrock-key',
          apiHost: '',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {
          awsBedrock: {
            authType: 'apiKey',
            apiKey: 'bedrock-api-key',
            region: 'us-west-2'
          }
        }
      )

      expect(result.defaultChatEndpoint).toBeNull()
      expect(result.authConfig).toEqual({ type: 'api-key-aws', region: 'us-west-2' })
      expect(result.apiKeys).toBeDefined()
      const apiKeys = result.apiKeys!
      expect(apiKeys).toHaveLength(1)
      expect(apiKeys[0]).toMatchObject({
        key: 'bedrock-api-key',
        isEnabled: true
      })
    })

    it('re-seats legacy Anthropic OAuth as api-key (web OAuth removed; tokens are gone)', () => {
      const result = transformProvider(
        {
          id: 'anthropic',
          name: 'Anthropic',
          type: 'anthropic',
          authType: 'oauth',
          apiKey: '',
          apiHost: 'https://api.anthropic.com',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {}
      )

      expect(result.authConfig).toEqual({ type: 'api-key' })
      // The user's custom Anthropic baseUrl must survive the OAuth→api-key
      // re-seat, and no phantom key should be invented.
      expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      expect(result.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl).toBe('https://api.anthropic.com')
      expect(result.apiKeys).toEqual([])
    })

    it('drops the legacy top-level apiKey for Bedrock api-key mode when awsBedrock.apiKey is absent', () => {
      // buildProviderApiKeys reads settings.awsBedrock.apiKey for Bedrock
      // api-key mode and ignores the top-level legacy.apiKey. Pin that drop
      // so the behavior is an explicit decision, not an accident.
      const result = transformProvider(
        {
          id: 'aws-bedrock',
          name: 'AWS Bedrock',
          type: 'aws-bedrock',
          apiKey: 'legacy-top-level-key',
          apiHost: '',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {
          awsBedrock: {
            authType: 'apiKey',
            region: 'us-east-1'
          }
        } as never
      )

      expect(result.authConfig).toEqual({ type: 'api-key-aws', region: 'us-east-1' })
      expect(result.apiKeys).toEqual([])
    })

    it('preserves OAuth for non-anthropic legacy providers (e.g. cherryin)', () => {
      const result = transformProvider(
        {
          id: 'someoauth',
          name: 'Some OAuth',
          type: 'openai',
          authType: 'oauth',
          apiKey: '',
          apiHost: 'https://example.com',
          models: [],
          enabled: true,
          isSystem: false
        } as never,
        {}
      )

      expect(result.authConfig).toEqual({ type: 'oauth', clientId: '' })
    })

    it('splits comma-separated API keys and drops empty entries', () => {
      const result = transformProvider(
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          apiKey: 'sk-a, sk-b ,, sk-c',
          apiHost: 'https://api.openai.com',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {}
      )

      expect(result.apiKeys?.map((key) => key.key)).toEqual(['sk-a', 'sk-b', 'sk-c'])
      expect(result.apiKeys?.every((key) => key.isEnabled)).toBe(true)
    })
  })

  describe('adapterFamily backfill', () => {
    it('infers adapterFamily from legacy type for a custom OpenAI-compatible provider', () => {
      const result = transformProvider(
        {
          id: 'my-custom',
          name: 'My Custom',
          type: 'openai',
          apiKey: 'k',
          apiHost: 'https://example.com/v1',
          models: [],
          enabled: true,
          isSystem: false
        } as never,
        {}
      )

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('openai-compatible')
    })

    it('routes a custom anthropic relay to the anthropic adapter even when legacy type is openai', () => {
      // Regression: the v1 Xiaomi MIMO token-plan relay was migrated with
      // type='openai' + an anthropicApiHost. Without a per-endpoint
      // adapterFamily the resolver fell back to openai-compatible and POSTed
      // `/anthropic/v1/chat/completions` → 404. The endpoint protocol must
      // win over the legacy relay type for ANTHROPIC_MESSAGES.
      const result = transformProvider(
        {
          id: '7c3dfc0b-985d-440b-b18b-e639fcf9218e',
          name: 'XIAOMI MIMO TOKEN PLAN',
          type: 'openai',
          apiKey: 'k',
          apiHost: '',
          anthropicApiHost: 'https://token-plan-cn.xiaomimimo.com/anthropic',
          models: [],
          enabled: true,
          isSystem: false
        } as never,
        {}
      )

      // The row deliberately stores NO adapterFamily for ANTHROPIC_MESSAGES:
      // the legacy-type hint ('openai-compatible') must not be persisted, and
      // read-time inference resolves the endpoint protocol ('anthropic') —
      // covered by ProviderService.readMerge.test.ts.
      expect(result.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toEqual({
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic'
      })
    })

    it('uses the more specific legacy-type family for non-anthropic endpoints (new-api → newapi)', () => {
      const result = transformProvider(
        {
          id: 'my-relay',
          name: 'My Relay',
          type: 'new-api',
          apiKey: 'k',
          apiHost: 'https://relay.example/v1',
          models: [],
          enabled: true,
          isSystem: false
        } as never,
        {}
      )

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('newapi')
    })

    it('adds adapterFamily without dropping baseUrl', () => {
      const result = transformProvider(
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          apiKey: 'k',
          apiHost: 'https://api.openai.com/v1',
          models: [],
          enabled: true,
          isSystem: true
        } as never,
        {}
      )

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toMatchObject({
        baseUrl: 'https://api.openai.com/v1',
        adapterFamily: 'openai-compatible'
      })
    })
  })

  describe('transformModel pricing', () => {
    it('maps the legacy CNY symbol to the CNY currency code', () => {
      const result = transformModel(
        {
          id: 'glm-4',
          name: 'GLM-4',
          pricing: { input_per_million_tokens: 8, output_per_million_tokens: 16, currencySymbol: '¥' }
        } as never,
        'zhipu'
      )

      expect(result.pricing).toEqual({
        input: { perMillionTokens: 8, currency: 'CNY' },
        output: { perMillionTokens: 16, currency: 'CNY' }
      })
    })

    it('maps the legacy USD symbol and an absent symbol to the USD currency code', () => {
      const withSymbol = transformModel(
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          pricing: { input_per_million_tokens: 3, output_per_million_tokens: 15, currencySymbol: '$' }
        } as never,
        'openai'
      )
      const withoutSymbol = transformModel(
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o mini',
          pricing: { input_per_million_tokens: 0.15, output_per_million_tokens: 0.6 }
        } as never,
        'openai'
      )

      expect(withSymbol.pricing).toEqual({
        input: { perMillionTokens: 3, currency: 'USD' },
        output: { perMillionTokens: 15, currency: 'USD' }
      })
      expect(withoutSymbol.pricing).toEqual({
        input: { perMillionTokens: 0.15, currency: 'USD' },
        output: { perMillionTokens: 0.6, currency: 'USD' }
      })
    })

    it('drops pricing in currencies the v2 contract cannot represent', () => {
      for (const currencySymbol of ['€', '£', 'CAD']) {
        const result = transformModel(
          {
            id: `unsupported-${currencySymbol}`,
            name: 'Unsupported currency',
            pricing: { input_per_million_tokens: 3, output_per_million_tokens: 15, currencySymbol }
          } as never,
          'custom'
        )

        expect(result.pricing).toBeNull()
      }
    })
  })
})
