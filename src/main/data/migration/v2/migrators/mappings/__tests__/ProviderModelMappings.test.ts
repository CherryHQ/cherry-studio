import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { describe, expect, it } from 'vitest'

import { transformProvider } from '../ProviderModelMappings'

describe('ProviderModelMappings', () => {
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
      expect(result.endpointConfigs).toEqual({
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          baseUrl: 'https://vertex-proxy.example.com/v1/projects/project-1/locations/us-central1'
        }
      })
    })

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
      expect(result.authConfig).toEqual({ type: 'api-key' })
      expect(result.apiKeys).toBeDefined()
      const apiKeys = result.apiKeys!
      expect(apiKeys).toHaveLength(1)
      expect(apiKeys[0]).toMatchObject({
        key: 'bedrock-api-key',
        isEnabled: true
      })
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
})
