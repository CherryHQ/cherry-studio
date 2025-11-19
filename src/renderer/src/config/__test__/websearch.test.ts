import { describe, expect, it, vi } from 'vitest'

import { GEMINI_SEARCH_REGEX } from '../models/websearch'

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      llm: {
        settings: {}
      }
    })
  }
}))

// FIXME: Idk why it's imported. Maybe circular dependency somewhere
vi.mock('@renderer/services/AssistantService.ts', () => ({
  getDefaultAssistant: () => {
    return {
      id: 'default',
      name: 'default',
      emoji: '😀',
      prompt: '',
      topics: [],
      messages: [],
      type: 'assistant',
      regularPhrases: [],
      settings: {}
    }
  },
  getProviderByModel: () => null
}))

describe('Gemini Search Models', () => {
  describe('GEMINI_SEARCH_REGEX', () => {
    it('should match gemini 2.x models', () => {
      expect(GEMINI_SEARCH_REGEX.test('gemini-2.0-flash')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-2.0-pro')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-2.5-flash')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-2.5-pro')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-2.5-flash-latest')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-2.5-pro-latest')).toBe(true)
    })

    it('should match gemini latest models', () => {
      expect(GEMINI_SEARCH_REGEX.test('gemini-flash-latest')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-pro-latest')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-flash-lite-latest')).toBe(true)
    })

    it('should match gemini 3 models', () => {
      // Preview versions
      expect(GEMINI_SEARCH_REGEX.test('gemini-3-pro-preview')).toBe(true)
      // Future stable versions
      expect(GEMINI_SEARCH_REGEX.test('gemini-3-flash')).toBe(true)
      expect(GEMINI_SEARCH_REGEX.test('gemini-3-pro')).toBe(true)
    })

    it('should not match older gemini models', () => {
      expect(GEMINI_SEARCH_REGEX.test('gemini-1.5-flash')).toBe(false)
      expect(GEMINI_SEARCH_REGEX.test('gemini-1.5-pro')).toBe(false)
      expect(GEMINI_SEARCH_REGEX.test('gemini-1.0-pro')).toBe(false)
    })
  })
})
