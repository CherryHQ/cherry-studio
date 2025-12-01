import store from '@renderer/store'
import type { VertexProvider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatApiHost,
  formatApiKeys,
  formatAzureOpenAIApiHost,
  formatVertexApiHost,
  getTrailingApiVersion,
  hasAPIVersion,
  maskApiKey,
  routeToEndpoint,
  splitApiKeyString,
  validateApiHost,
  withoutTrailingApiVersion,
  withoutTrailingSharp
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

    it('removes trailing # and does not append api version when host ends with #', () => {
      expect(formatApiHost('https://api.example.com#')).toBe('https://api.example.com')
      expect(formatApiHost('http://localhost:5173/#')).toBe('http://localhost:5173/')
      expect(formatApiHost(' https://api.openai.com/# ')).toBe('https://api.openai.com/')
    })

    it('handles trailing # with custom api version settings', () => {
      expect(formatApiHost('https://api.example.com#', true, 'v2')).toBe('https://api.example.com')
      expect(formatApiHost('https://api.example.com#', false, 'v2')).toBe('https://api.example.com')
    })

    it('handles host with both trailing # and existing api version', () => {
      expect(formatApiHost('https://api.example.com/v2#')).toBe('https://api.example.com/v2')
      expect(formatApiHost('https://api.example.com/v3beta#')).toBe('https://api.example.com/v3beta')
    })

    it('trims whitespace before processing trailing #', () => {
      expect(formatApiHost('  https://api.example.com#  ')).toBe('https://api.example.com')
      expect(formatApiHost('\thttps://api.example.com#\n')).toBe('https://api.example.com')
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

    it('return flase when starting without v character', () => {
      expect(hasAPIVersion('https://api.example.com/a1v')).toBe(false)
      expect(hasAPIVersion('/av1/users')).toBe(false)
    })

    it('return flase when starting with v- word', () => {
      expect(hasAPIVersion('https://api.example.com/vendor')).toBe(false)
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

  describe('validateApiHost', () => {
    it('accepts empty or whitespace-only host', () => {
      expect(validateApiHost('')).toBe(true)
      expect(validateApiHost('   ')).toBe(true)
    })

    it('rejects unsupported protocols', () => {
      expect(validateApiHost('ftp://api.example.com')).toBe(false)
    })

    it('validates supported endpoint fragments when using hash suffix', () => {
      expect(validateApiHost('https://api.example.com/v1/chat/completions#')).toBe(true)
      expect(validateApiHost('https://api.example.com/v1/unknown#')).toBe(true)
    })
  })

  describe('routeToEndpoint', () => {
    it('returns host without endpoint when not using hash suffix', () => {
      expect(routeToEndpoint(' https://api.example.com/v1 ')).toEqual({
        baseURL: 'https://api.example.com/v1',
        endpoint: ''
      })
    })

    it('extracts known endpoint and base url when using hash suffix', () => {
      expect(routeToEndpoint('https://api.example.com/v1/chat/completions#')).toEqual({
        baseURL: 'https://api.example.com/v1',
        endpoint: 'chat/completions'
      })
    })

    it('returns empty endpoint when unsupported endpoint fragment is provided', () => {
      expect(routeToEndpoint('https://api.example.com/v1/custom#')).toEqual({
        baseURL: 'https://api.example.com/v1/custom',
        endpoint: ''
      })
    })

    it('prefers the most specific endpoint match when multiple matches exist', () => {
      expect(routeToEndpoint('https://api.example.com/v1/streamGenerateContent#')).toEqual({
        baseURL: 'https://api.example.com/v1',
        endpoint: 'streamGenerateContent'
      })
    })

    it('extract OpenAI images generations endpoint', () => {
      expect(routeToEndpoint('https://open.cherryin.net/v1/images/generations#')).toEqual({
        baseURL: 'https://open.cherryin.net/v1',
        endpoint: 'images/generations'
      })
    })

    it('extract Gemini images generation endpoint', () => {
      expect(routeToEndpoint('https://open.cherryin.net/v1beta/models/imagen-4.0-generate-001:predict#')).toEqual({
        baseURL: 'https://open.cherryin.net/v1beta/models/imagen-4.0-generate-001',
        endpoint: 'predict'
      })
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

  describe('getTrailingApiVersion', () => {
    it('extracts trailing API version from URL', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1')).toBe('v1')
      expect(getTrailingApiVersion('https://api.example.com/v2')).toBe('v2')
    })

    it('extracts trailing API version with alpha/beta suffix', () => {
      expect(getTrailingApiVersion('https://api.example.com/v2alpha')).toBe('v2alpha')
      expect(getTrailingApiVersion('https://api.example.com/v3beta')).toBe('v3beta')
    })

    it('extracts trailing API version with trailing slash', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1/')).toBe('v1')
      expect(getTrailingApiVersion('https://api.example.com/v2beta/')).toBe('v2beta')
    })

    it('returns undefined when API version is in the middle of path', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1/chat')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/v1/completions')).toBeUndefined()
    })

    it('returns undefined when no trailing version exists', () => {
      expect(getTrailingApiVersion('https://api.example.com')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/api')).toBeUndefined()
    })

    it('extracts trailing version from complex URLs', () => {
      expect(getTrailingApiVersion('https://api.example.com/service/v1')).toBe('v1')
      expect(getTrailingApiVersion('https://gateway.ai.cloudflare.com/v1/xxx/google-ai-studio/v1beta')).toBe('v1beta')
    })

    it('only extracts the trailing version when multiple versions exist', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1/service/v2')).toBe('v2')
      expect(
        getTrailingApiVersion('https://gateway.ai.cloudflare.com/v1/xxxxxx/google-ai-studio/google-ai-studio/v1beta')
      ).toBe('v1beta')
    })

    it('returns undefined for empty string', () => {
      expect(getTrailingApiVersion('')).toBeUndefined()
    })
  })

  describe('withoutTrailingApiVersion', () => {
    it('removes trailing API version from URL', () => {
      expect(withoutTrailingApiVersion('https://api.example.com/v1')).toBe('https://api.example.com')
      expect(withoutTrailingApiVersion('https://api.example.com/v2')).toBe('https://api.example.com')
    })

    it('removes trailing API version with alpha/beta suffix', () => {
      expect(withoutTrailingApiVersion('https://api.example.com/v2alpha')).toBe('https://api.example.com')
      expect(withoutTrailingApiVersion('https://api.example.com/v3beta')).toBe('https://api.example.com')
    })

    it('removes trailing API version with trailing slash', () => {
      expect(withoutTrailingApiVersion('https://api.example.com/v1/')).toBe('https://api.example.com')
      expect(withoutTrailingApiVersion('https://api.example.com/v2beta/')).toBe('https://api.example.com')
    })

    it('does not remove API version in the middle of path', () => {
      expect(withoutTrailingApiVersion('https://api.example.com/v1/chat')).toBe('https://api.example.com/v1/chat')
      expect(withoutTrailingApiVersion('https://api.example.com/v1/completions')).toBe(
        'https://api.example.com/v1/completions'
      )
    })

    it('returns URL unchanged when no trailing version exists', () => {
      expect(withoutTrailingApiVersion('https://api.example.com')).toBe('https://api.example.com')
      expect(withoutTrailingApiVersion('https://api.example.com/api')).toBe('https://api.example.com/api')
    })

    it('handles complex URLs with version at the end', () => {
      expect(withoutTrailingApiVersion('https://api.example.com/service/v1')).toBe('https://api.example.com/service')
    })

    it('handles URLs with multiple versions but only removes the trailing one', () => {
      expect(withoutTrailingApiVersion('https://api.example.com/v1/service/v2')).toBe(
        'https://api.example.com/v1/service'
      )
    })

    it('returns empty string unchanged', () => {
      expect(withoutTrailingApiVersion('')).toBe('')
    })
  })

  describe('withoutTrailingSharp', () => {
    it('removes trailing # from URL', () => {
      expect(withoutTrailingSharp('https://api.example.com#')).toBe('https://api.example.com')
      expect(withoutTrailingSharp('http://localhost:3000#')).toBe('http://localhost:3000')
    })

    it('returns URL unchanged when no trailing #', () => {
      expect(withoutTrailingSharp('https://api.example.com')).toBe('https://api.example.com')
      expect(withoutTrailingSharp('http://localhost:3000')).toBe('http://localhost:3000')
    })

    it('handles URLs with multiple # characters but only removes trailing one', () => {
      expect(withoutTrailingSharp('https://api.example.com#path#')).toBe('https://api.example.com#path')
    })

    it('handles URLs with # in the middle (not trailing)', () => {
      expect(withoutTrailingSharp('https://api.example.com#section/path')).toBe('https://api.example.com#section/path')
      expect(withoutTrailingSharp('https://api.example.com/v1/chat/completions#')).toBe(
        'https://api.example.com/v1/chat/completions'
      )
    })

    it('handles empty string', () => {
      expect(withoutTrailingSharp('')).toBe('')
    })

    it('handles single character #', () => {
      expect(withoutTrailingSharp('#')).toBe('')
    })

    it('preserves whitespace around the URL (pure function)', () => {
      expect(withoutTrailingSharp('  https://api.example.com#  ')).toBe('  https://api.example.com#  ')
      expect(withoutTrailingSharp('\thttps://api.example.com#\n')).toBe('\thttps://api.example.com#\n')
    })

    it('only removes exact trailing # character', () => {
      expect(withoutTrailingSharp('https://api.example.com# ')).toBe('https://api.example.com# ')
      expect(withoutTrailingSharp(' https://api.example.com#')).toBe(' https://api.example.com')
      expect(withoutTrailingSharp('https://api.example.com#\t')).toBe('https://api.example.com#\t')
    })

    it('handles URLs ending with multiple # characters', () => {
      expect(withoutTrailingSharp('https://api.example.com##')).toBe('https://api.example.com#')
      expect(withoutTrailingSharp('https://api.example.com###')).toBe('https://api.example.com##')
    })

    it('preserves URL with trailing # and other content', () => {
      expect(withoutTrailingSharp('https://api.example.com/v1#')).toBe('https://api.example.com/v1')
      expect(withoutTrailingSharp('https://api.example.com/v2beta#')).toBe('https://api.example.com/v2beta')
    })
  })
})
