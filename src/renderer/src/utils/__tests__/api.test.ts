import { describe, expect, it } from 'vitest'

import { formatApiHost, maskApiKey, splitApiKeyString } from '../api'

describe('api', () => {
  describe('formatApiHost', () => {
    it('should return original host when it ends with a slash', () => {
      expect(formatApiHost('https://api.example.com/')).toBe('https://api.example.com/')
      expect(formatApiHost('http://localhost:5173/')).toBe('http://localhost:5173/')
    })

    it('should return original host when it ends with volces.com/api/v3', () => {
      expect(formatApiHost('https://api.volces.com/api/v3')).toBe('https://api.volces.com/api/v3')
      expect(formatApiHost('http://volces.com/api/v3')).toBe('http://volces.com/api/v3')
    })

    it('should append /v1/ to hosts that do not match special conditions', () => {
      expect(formatApiHost('https://api.example.com')).toBe('https://api.example.com/v1/')
      expect(formatApiHost('http://localhost:5173')).toBe('http://localhost:5173/v1/')
      expect(formatApiHost('https://api.openai.com')).toBe('https://api.openai.com/v1/')
    })

    it('should not modify hosts that already have a path but do not end with a slash', () => {
      expect(formatApiHost('https://api.example.com/custom')).toBe('https://api.example.com/custom/v1/')
    })

    it('should handle empty string gracefully', () => {
      expect(formatApiHost('')).toBe('')
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
})
