import { describe, expect, it, vi } from 'vitest'

import { isVisionModel } from '../models/vision'

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

describe('isVisionModel', () => {
  describe('Gemini Models', () => {
    it('should return true for gemini 1.5 models', () => {
      expect(
        isVisionModel({
          id: 'gemini-1.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-1.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini 2.x models', () => {
      expect(
        isVisionModel({
          id: 'gemini-2.0-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-2.0-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-2.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-2.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini latest models', () => {
      expect(
        isVisionModel({
          id: 'gemini-flash-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-pro-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-flash-lite-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini 3 models', () => {
      // Preview versions
      expect(
        isVisionModel({
          id: 'gemini-3-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Future stable versions
      expect(
        isVisionModel({
          id: 'gemini-3-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-3-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini exp models', () => {
      expect(
        isVisionModel({
          id: 'gemini-exp-1206',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return false for gemini 1.0 models', () => {
      expect(
        isVisionModel({
          id: 'gemini-1.0-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })
  })
})
