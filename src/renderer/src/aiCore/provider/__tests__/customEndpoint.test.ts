/**
 * Tests for custom endpoint extraction from API host URL using '#' suffix.
 *
 * This test file verifies the fix for issue #12123:
 * When adding a custom model service provider, using "#" to remove the suffix
 * when entering the API URL should work correctly.
 *
 * @see https://github.com/CherryHQ/cherry-studio/issues/12123
 */
import type { Provider } from '@renderer/types'
import { isWithTrailingSharp, routeToEndpoint } from '@renderer/utils/api'
import { describe, expect, it } from 'vitest'

import { formatProviderApiHost } from '../providerConfig'

/**
 * Creates a minimal custom provider for testing
 */
function createCustomProvider(apiHost: string): Provider {
  return {
    id: 'custom-provider',
    type: 'openai',
    name: 'Custom Provider',
    apiKey: 'test-key',
    apiHost,
    models: [],
    isSystem: false
  }
}

describe('Custom endpoint extraction (#12123 fix)', () => {
  describe('isWithTrailingSharp', () => {
    it('should detect trailing # in URL', () => {
      expect(isWithTrailingSharp('https://api.example.com/v1/chat/completions#')).toBe(true)
      expect(isWithTrailingSharp('https://api.example.com/v1#')).toBe(true)
      expect(isWithTrailingSharp('https://api.example.com#')).toBe(true)
    })

    it('should return false for URL without trailing #', () => {
      expect(isWithTrailingSharp('https://api.example.com/v1/chat/completions')).toBe(false)
      expect(isWithTrailingSharp('https://api.example.com/v1')).toBe(false)
      expect(isWithTrailingSharp('https://api.example.com#section')).toBe(false)
    })
  })

  describe('routeToEndpoint', () => {
    it('should extract chat/completions endpoint from URL with #', () => {
      const result = routeToEndpoint('https://api.example.com/v1/chat/completions#')
      expect(result.baseURL).toBe('https://api.example.com/v1')
      expect(result.endpoint).toBe('chat/completions')
    })

    it('should extract messages endpoint (Anthropic) from URL with #', () => {
      const result = routeToEndpoint('https://api.example.com/v1/messages#')
      expect(result.baseURL).toBe('https://api.example.com/v1')
      expect(result.endpoint).toBe('messages')
    })

    it('should extract responses endpoint (OpenAI Responses API) from URL with #', () => {
      const result = routeToEndpoint('https://api.example.com/v1/responses#')
      expect(result.baseURL).toBe('https://api.example.com/v1')
      expect(result.endpoint).toBe('responses')
    })

    it('should return empty endpoint for URL without #', () => {
      const result = routeToEndpoint('https://api.example.com/v1/chat/completions')
      expect(result.baseURL).toBe('https://api.example.com/v1/chat/completions')
      expect(result.endpoint).toBe('')
    })

    it('should return empty endpoint for unsupported endpoint with #', () => {
      const result = routeToEndpoint('https://api.example.com/v1/custom-endpoint#')
      expect(result.baseURL).toBe('https://api.example.com/v1/custom-endpoint')
      expect(result.endpoint).toBe('')
    })
  })

  describe('formatProviderApiHost - customEndpoint extraction', () => {
    it('should extract customEndpoint when apiHost ends with chat/completions#', () => {
      const provider = createCustomProvider('https://api.example.com/openai/chat/completions#')
      const result = formatProviderApiHost(provider)

      // customEndpoint should be extracted
      expect(result.customEndpoint).toBe('chat/completions')
      // apiHost should be the base URL without the endpoint
      expect(result.apiHost).toBe('https://api.example.com/openai')
    })

    it('should extract customEndpoint when apiHost ends with messages#', () => {
      const provider = createCustomProvider('https://api.example.com/v1/messages#')
      const result = formatProviderApiHost(provider)

      expect(result.customEndpoint).toBe('messages')
      expect(result.apiHost).toBe('https://api.example.com/v1')
    })

    it('should not set customEndpoint when apiHost does not end with #', () => {
      const provider = createCustomProvider('https://api.example.com/v1')
      const result = formatProviderApiHost(provider)

      expect(result.customEndpoint).toBeUndefined()
    })

    it('should not set customEndpoint for unsupported endpoint with #', () => {
      const provider = createCustomProvider('https://api.example.com/v1/unsupported#')
      const result = formatProviderApiHost(provider)

      // When endpoint is not in SUPPORTED_ENDPOINT_LIST, customEndpoint should not be set
      expect(result.customEndpoint).toBeUndefined()
    })

    it('should handle real-world custom API URL pattern', () => {
      // Real scenario from issue #12123
      const provider = createCustomProvider('https://custom-api.example.com/openai/chat/completions#')
      const result = formatProviderApiHost(provider)

      expect(result.customEndpoint).toBe('chat/completions')
      expect(result.apiHost).toBe('https://custom-api.example.com/openai')
    })

    it('should handle URL with version path and endpoint', () => {
      const provider = createCustomProvider('https://api.example.com/v1/chat/completions#')
      const result = formatProviderApiHost(provider)

      expect(result.customEndpoint).toBe('chat/completions')
      expect(result.apiHost).toBe('https://api.example.com/v1')
    })
  })
})
