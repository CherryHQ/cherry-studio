import store from '@renderer/store'
import type { VertexProvider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatApiHost,
  formatApiKeys,
  formatAzureOpenAIApiHost,
  formatVertexApiHost,
  hasAPIVersion,
  maskApiKey,
  splitApiKeyString
} from '../api'

vi.mock('@renderer/store', () => {
  const getState = vi.fn()
  return {
    default: {
      getState
    }
  }
})

const getStateMock = store.getState as unknown as ReturnType<typeof vi.fn>

const createVertexProvider = (apiHost: string): VertexProvider => ({
  id: 'vertex-provider',
  type: 'vertexai',
  name: 'Vertex AI',
  apiKey: '',
  apiHost,
  models: [],
  googleCredentials: {
    privateKey: '',
    clientEmail: ''
  },
  project: '',
  location: ''
})

beforeEach(() => {
  getStateMock.mockReset()
  getStateMock.mockReturnValue({
    llm: {
      settings: {
        vertexai: {
          projectId: 'test-project',
          location: 'us-central1'
        }
      }
    }
  })
})

describe('api', () => {
  describe('formatApiHost', () => {
    it('returns empty string for falsy host', () => {
      expect(formatApiHost('')).toBe('')
      expect(formatApiHost(undefined)).toBe('')
    })

    it('appends api version when missing', () => {
      expect(formatApiHost('https://api.example.com')).toBe('https://api.example.com/v1')
      expect(formatApiHost('http://localhost:5173/')).toBe('http://localhost:5173/v1')
      expect(formatApiHost(' https://api.openai.com ')).toBe('https://api.openai.com/v1')
    })

    it('keeps original host when api version already present', () => {
      expect(formatApiHost('https://api.volces.com/api/v3')).toBe('https://api.volces.com/api/v3')
      expect(formatApiHost('http://localhost:5173/v2beta')).toBe('http://localhost:5173/v2beta')
    })

    it('supports custom api version parameter', () => {
      expect(formatApiHost('https://api.example.com', true, 'v2')).toBe('https://api.example.com/v2')
    })

    it('keeps host untouched when api version unsupported', () => {
      expect(formatApiHost('https://api.example.com', false)).toBe('https://api.example.com')
    })
  })

  describe('hasAPIVersion', () => {
    it('detects numeric version suffix', () => {
      expect(hasAPIVersion('https://api.example.com/v1')).toBe(true)
      expect(hasAPIVersion('http://localhost:3000/v2beta')).toBe(true)
      expect(hasAPIVersion('/v3alpha/resources')).toBe(true)
    })

    it('returns false when no version found', () => {
      expect(hasAPIVersion('https://api.example.com')).toBe(false)
      expect(hasAPIVersion('')).toBe(false)
      expect(hasAPIVersion(undefined)).toBe(false)
    })
  })

  describe('maskApiKey', () => {
    it('should return empty string when key is empty', () => {
      expect(maskApiKey('')).toBe('')
      expect(maskApiKey(null as unknown as string)).toBe('')
      expect(maskApiKey(undefined as unknown as string)).toBe('')
    })

    it('should mask keys longer than 24 characters', () => {
      const key = '1234567890abcdefghijklmnopqrstuvwxyz'
      expect(maskApiKey(key)).toBe('12345678****stuvwxyz')
    })

    it('should mask keys longer than 16 characters but not longer than 24', () => {
      const key = '1234567890abcdefgh'
      expect(maskApiKey(key)).toBe('1234****efgh')
    })

    it('should mask keys longer than 8 characters but not longer than 16', () => {
      const key = '1234567890'
      expect(maskApiKey(key)).toBe('12****90')
    })

    it('should not mask keys that are 8 characters or shorter', () => {
      expect(maskApiKey('12345678')).toBe('12345678')
      expect(maskApiKey('123')).toBe('123')
    })

    it('should handle keys at exactly the boundary conditions', () => {
      // 24 characters
      expect(maskApiKey('123456789012345678901234')).toBe('1234****1234')

      // 16 characters
      expect(maskApiKey('1234567890123456')).toBe('12****56')

      // 8 characters
      expect(maskApiKey('12345678')).toBe('12345678')
    })
  })

  describe('splitApiKeyString', () => {
    it('should split comma-separated keys', () => {
      const input = 'key1,key2,key3'
      const result = splitApiKeyString(input)
      expect(result).toEqual(['key1', 'key2', 'key3'])
    })

    it('should trim spaces around keys', () => {
      const input = ' key1 , key2 ,key3 '
      const result = splitApiKeyString(input)
      expect(result).toEqual(['key1', 'key2', 'key3'])
    })

    it('should handle escaped commas', () => {
      const input = 'key1,key2\\,withcomma,key3'
      const result = splitApiKeyString(input)
      expect(result).toEqual(['key1', 'key2,withcomma', 'key3'])
    })

    it('should handle multiple escaped commas', () => {
      const input = 'key1\\,withcomma1,key2\\,withcomma2'
      const result = splitApiKeyString(input)
      expect(result).toEqual(['key1,withcomma1', 'key2,withcomma2'])
    })

    it('should ignore empty keys', () => {
      const input = 'key1,,key2, ,key3'
      const result = splitApiKeyString(input)
      expect(result).toEqual(['key1', 'key2', 'key3'])
    })

    it('should return empty array for empty string', () => {
      const input = ''
      const result = splitApiKeyString(input)
      expect(result).toEqual([])
    })

    it('should handle only one key', () => {
      const input = 'singlekey'
      const result = splitApiKeyString(input)
      expect(result).toEqual(['singlekey'])
    })

    it('should handle only escaped comma', () => {
      const input = 'key\\,withcomma'
      const result = splitApiKeyString(input)
      expect(result).toEqual(['key,withcomma'])
    })

    it('should handle all keys with spaces and escaped commas', () => {
      const input = ' key1 , key2\\,withcomma , key3 '
      const result = splitApiKeyString(input)
      expect(result).toEqual(['key1', 'key2,withcomma', 'key3'])
    })
  })

  describe('formatApiKeys', () => {
    it('normalizes chinese commas and new lines', () => {
      expect(formatApiKeys('key1，key2\nkey3')).toBe('key1,key2,key3')
    })

    it('returns empty string unchanged', () => {
      expect(formatApiKeys('')).toBe('')
    })
  })

  describe('formatAzureOpenAIApiHost', () => {
    it('normalizes trailing segments and disables auto version append', () => {
      expect(formatAzureOpenAIApiHost('https://example.openai.azure.com/')).toBe(
        'https://example.openai.azure.com/openai'
      )
      expect(formatAzureOpenAIApiHost('https://example.openai.azure.com/openai/')).toBe(
        'https://example.openai.azure.com/openai'
      )
    })
  })

  describe('formatVertexApiHost', () => {
    it('builds default google endpoint when host absent', () => {
      expect(formatVertexApiHost(createVertexProvider(''))).toBe(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1'
      )
    })

    it('prefers default endpoint when host ends with google domain', () => {
      expect(formatVertexApiHost(createVertexProvider('https://aiplatform.googleapis.com'))).toBe(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1'
      )
    })

    it('appends api version to custom host', () => {
      expect(formatVertexApiHost(createVertexProvider('https://custom.googleapis.com/vertex'))).toBe(
        'https://custom.googleapis.com/vertex/v1'
      )
    })

    it('uses global endpoint when location equals global', () => {
      getStateMock.mockReturnValueOnce({
        llm: {
          settings: {
            vertexai: {
              projectId: 'global-project',
              location: 'global'
            }
          }
        }
      })

      expect(formatVertexApiHost(createVertexProvider(''))).toBe(
        'https://aiplatform.googleapis.com/v1/projects/global-project/locations/global'
      )
    })
  })
})
