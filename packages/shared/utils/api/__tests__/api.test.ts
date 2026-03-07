import { describe, expect, it } from 'vitest'

import {
  formatApiHost,
  formatApiKeys,
  getTrailingApiVersion,
  hasAPIVersion,
  isWithTrailingSharp,
  withoutTrailingApiVersion,
  withoutTrailingSharp
} from '..'

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

    it('return false when starting without v character', () => {
      expect(hasAPIVersion('https://api.example.com/a1v')).toBe(false)
      expect(hasAPIVersion('/av1/users')).toBe(false)
    })

    it('return false when starting with v- word', () => {
      expect(hasAPIVersion('https://api.example.com/vendor')).toBe(false)
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

    it('returns undefined when URL ends with # regardless of version', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1#')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/v2beta#')).toBeUndefined()
      expect(getTrailingApiVersion('https://gateway.ai.cloudflare.com/v1#')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/service/v1#')).toBeUndefined()
    })

    it('handles URLs with # and trailing slash correctly', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1/#')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/v2beta/#')).toBeUndefined()
    })

    it('handles URLs with version followed by # and additional path', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1#endpoint')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/v2beta#chat/completions')).toBeUndefined()
    })

    it('handles complex URLs with multiple # characters', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1#path#')).toBeUndefined()
      expect(getTrailingApiVersion('https://gateway.ai.cloudflare.com/v1/xxx/v2beta#')).toBeUndefined()
    })

    it('handles URLs ending with # when version is not at the end', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1/service#')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/v1/api/chat#')).toBeUndefined()
    })

    it('distinguishes between URLs with and without trailing #', () => {
      expect(getTrailingApiVersion('https://api.example.com/v1')).toBe('v1')
      expect(getTrailingApiVersion('https://api.example.com/v2beta')).toBe('v2beta')
      expect(getTrailingApiVersion('https://api.example.com/v1#')).toBeUndefined()
      expect(getTrailingApiVersion('https://api.example.com/v2beta#')).toBeUndefined()
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

  describe('isWithTrailingSharp', () => {
    it('returns true when URL ends with #', () => {
      expect(isWithTrailingSharp('https://api.example.com#')).toBe(true)
      expect(isWithTrailingSharp('http://localhost:3000#')).toBe(true)
      expect(isWithTrailingSharp('#')).toBe(true)
    })

    it('returns false when URL does not end with #', () => {
      expect(isWithTrailingSharp('https://api.example.com')).toBe(false)
      expect(isWithTrailingSharp('http://localhost:3000')).toBe(false)
      expect(isWithTrailingSharp('')).toBe(false)
    })

    it('returns false when URL has # in the middle but not at the end', () => {
      expect(isWithTrailingSharp('https://api.example.com#path')).toBe(false)
      expect(isWithTrailingSharp('https://api.example.com#section/path')).toBe(false)
      expect(isWithTrailingSharp('https://api.example.com#path#other')).toBe(false)
    })

    it('handles URLs with multiple # characters', () => {
      expect(isWithTrailingSharp('https://api.example.com##')).toBe(true)
      expect(isWithTrailingSharp('https://api.example.com#path#')).toBe(true)
      expect(isWithTrailingSharp('https://api.example.com###')).toBe(true)
    })

    it('handles URLs with trailing whitespace after #', () => {
      expect(isWithTrailingSharp('https://api.example.com# ')).toBe(false)
      expect(isWithTrailingSharp('https://api.example.com#\t')).toBe(false)
      expect(isWithTrailingSharp('https://api.example.com#\n')).toBe(false)
    })

    it('handles URLs with whitespace before trailing #', () => {
      expect(isWithTrailingSharp('  https://api.example.com#')).toBe(true)
      expect(isWithTrailingSharp('\thttps://localhost:3000#')).toBe(true)
    })

    it('preserves type safety with generic parameter', () => {
      const url1: string = 'https://api.example.com#'
      const url2 = 'https://example.com' as const

      expect(isWithTrailingSharp(url1)).toBe(true)
      expect(isWithTrailingSharp(url2)).toBe(false)
    })

    it('handles complex real-world URLs', () => {
      expect(isWithTrailingSharp('https://open.cherryin.net/v1/chat/completions#')).toBe(true)
      expect(isWithTrailingSharp('https://api.openai.com/v1/engines/gpt-4#')).toBe(true)
      expect(isWithTrailingSharp('https://gateway.ai.cloudflare.com/v1/xxx/v1beta#')).toBe(true)

      expect(isWithTrailingSharp('https://open.cherryin.net/v1/chat/completions')).toBe(false)
      expect(isWithTrailingSharp('https://api.openai.com/v1/engines/gpt-4')).toBe(false)
      expect(isWithTrailingSharp('https://gateway.ai.cloudflare.com/v1/xxx/v1beta')).toBe(false)
    })

    it('handles edge cases', () => {
      expect(isWithTrailingSharp('#')).toBe(true)
      expect(isWithTrailingSharp(' #')).toBe(true)
      expect(isWithTrailingSharp('# ')).toBe(false)
      expect(isWithTrailingSharp('path#')).toBe(true)
      expect(isWithTrailingSharp('/path/with/trailing/#')).toBe(true)
      expect(isWithTrailingSharp('/path/without/trailing/')).toBe(false)
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
