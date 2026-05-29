import { describe, expect, it } from 'vitest'

import { formatAzureOpenAIApiHost, formatOllamaApiHost } from '../api'

describe('provider api utils', () => {
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

  describe('formatOllamaApiHost', () => {
    it('removes trailing slash and appends /api for basic hosts', () => {
      expect(formatOllamaApiHost('https://api.ollama.com/')).toBe('https://api.ollama.com/api')
      expect(formatOllamaApiHost('http://localhost:11434/')).toBe('http://localhost:11434/api')
    })

    it('appends /api when no suffix is present', () => {
      expect(formatOllamaApiHost('https://api.ollama.com')).toBe('https://api.ollama.com/api')
      expect(formatOllamaApiHost('http://localhost:11434')).toBe('http://localhost:11434/api')
    })

    it('removes /v1 suffix and appends /api', () => {
      expect(formatOllamaApiHost('https://api.ollama.com/v1')).toBe('https://api.ollama.com/api')
      expect(formatOllamaApiHost('http://localhost:11434/v1/')).toBe('http://localhost:11434/api')
    })

    it('removes /api suffix and keeps /api', () => {
      expect(formatOllamaApiHost('https://api.ollama.com/api')).toBe('https://api.ollama.com/api')
      expect(formatOllamaApiHost('http://localhost:11434/api/')).toBe('http://localhost:11434/api')
    })

    it('removes /chat suffix and appends /api', () => {
      expect(formatOllamaApiHost('https://api.ollama.com/chat')).toBe('https://api.ollama.com/api')
      expect(formatOllamaApiHost('http://localhost:11434/chat/')).toBe('http://localhost:11434/api')
    })

    it('handles multiple suffix combinations correctly', () => {
      expect(formatOllamaApiHost('https://api.ollama.com/v1/chat')).toBe('https://api.ollama.com/v1/api')
      expect(formatOllamaApiHost('https://api.ollama.com/chat/v1')).toBe('https://api.ollama.com/api')
      expect(formatOllamaApiHost('https://api.ollama.com/api/chat')).toBe('https://api.ollama.com/api/api')
    })

    it('preserves complex paths while handling suffixes', () => {
      expect(formatOllamaApiHost('https://api.ollama.com/custom/path')).toBe('https://api.ollama.com/custom/path/api')
      expect(formatOllamaApiHost('https://api.ollama.com/custom/path/')).toBe('https://api.ollama.com/custom/path/api')
      expect(formatOllamaApiHost('https://api.ollama.com/custom/path/v1')).toBe(
        'https://api.ollama.com/custom/path/api'
      )
    })

    it('handles edge cases with multiple slashes', () => {
      expect(formatOllamaApiHost('https://api.ollama.com//')).toBe('https://api.ollama.com//api')
      expect(formatOllamaApiHost('https://api.ollama.com///v1///')).toBe('https://api.ollama.com///v1///api')
    })

    it('handles localhost with different ports', () => {
      expect(formatOllamaApiHost('http://localhost:3000')).toBe('http://localhost:3000/api')
      expect(formatOllamaApiHost('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434/api')
      expect(formatOllamaApiHost('https://localhost:8080/v1')).toBe('https://localhost:8080/api')
    })

    it('handles IP addresses', () => {
      expect(formatOllamaApiHost('http://192.168.1.100:11434')).toBe('http://192.168.1.100:11434/api')
      expect(formatOllamaApiHost('https://10.0.0.1:8080/v1/')).toBe('https://10.0.0.1:8080/api')
    })

    it('handles empty strings and edge cases', () => {
      expect(formatOllamaApiHost('')).toBe('/api')
      expect(formatOllamaApiHost('/')).toBe('/api')
    })

    it('preserves protocol and handles mixed case', () => {
      expect(formatOllamaApiHost('HTTPS://API.OLLAMA.COM')).toBe('HTTPS://API.OLLAMA.COM/api')
      expect(formatOllamaApiHost('HTTP://localhost:11434/V1/')).toBe('HTTP://localhost:11434/V1/api')
    })
  })
})
