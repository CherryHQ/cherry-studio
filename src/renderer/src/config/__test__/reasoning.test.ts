import { describe, expect, it, vi } from 'vitest'

import { isDoubaoSeedAfter251015, isDoubaoThinkingAutoModel } from '../models/reasoning'

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
  }
}))

describe('Doubao Models', () => {
  describe('isDoubaoThinkingAutoModel', () => {
    it('should return false for invalid models', () => {
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-251015',
          name: 'doubao-seed-1-6-251015',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-lite-251015',
          name: 'doubao-seed-1-6-lite-251015',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-thinking-250715',
          name: 'doubao-seed-1-6-thinking-250715',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-flash',
          name: 'doubao-seed-1-6-flash',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-thinking',
          name: 'doubao-seed-1-6-thinking',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return true for valid models', () => {
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-250615',
          name: 'doubao-seed-1-6-250615',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'Doubao-Seed-1.6',
          name: 'Doubao-Seed-1.6',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-1-5-thinking-pro-m',
          name: 'doubao-1-5-thinking-pro-m',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1.6-lite',
          name: 'doubao-seed-1.6-lite',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-1-5-thinking-pro-m-12345',
          name: 'doubao-1-5-thinking-pro-m-12345',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })
  })

  describe('isDoubaoSeedAfter251015', () => {
    it('should return true for models matching the pattern', () => {
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-251015',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-lite-251015',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return false for models not matching the pattern', () => {
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-250615',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoSeedAfter251015({
          id: 'Doubao-Seed-1.6',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-1-5-thinking-pro-m',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-lite-251016',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })
  })
})
