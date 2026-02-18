import type { MemoryItem, UserPreference } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { getMemoryContextPrompt, getPersonalizationPrompt } from '../memory-prompts'

describe('memory-prompts', () => {
  describe('getMemoryContextPrompt', () => {
    it('returns empty string for empty memories', () => {
      expect(getMemoryContextPrompt([])).toBe('')
    })

    it('formats single memory correctly', () => {
      const memories: MemoryItem[] = [{ id: '1', memory: 'User likes Python', score: 0.9 }]
      const result = getMemoryContextPrompt(memories)
      expect(result).toContain('1. User likes Python')
      expect(result).toContain('与用户相关的记忆信息')
    })

    it('formats multiple memories correctly', () => {
      const memories: MemoryItem[] = [
        { id: '1', memory: 'User likes Python', score: 0.9 },
        { id: '2', memory: 'User is a developer', score: 0.85 }
      ]
      const result = getMemoryContextPrompt(memories)
      expect(result).toContain('1. User likes Python')
      expect(result).toContain('2. User is a developer')
    })
  })

  describe('getPersonalizationPrompt', () => {
    it('returns empty string for empty preferences', () => {
      expect(getPersonalizationPrompt([])).toBe('')
    })

    it('adds beginner technical depth instruction', () => {
      const preferences: UserPreference[] = [{ type: 'technical_depth', value: 'beginner', source: '1' }]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('简单易懂的语言')
      expect(result).toContain('避免专业术语')
    })

    it('adds expert technical depth instruction', () => {
      const preferences: UserPreference[] = [{ type: 'technical_depth', value: 'expert', source: '1' }]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('专业术语')
    })

    it('adds concise response length instruction', () => {
      const preferences: UserPreference[] = [{ type: 'response_length', value: 'concise', source: '1' }]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('简洁')
    })

    it('adds detailed response length instruction', () => {
      const preferences: UserPreference[] = [{ type: 'response_length', value: 'detailed', source: '1' }]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('详细')
    })

    it('combines multiple preferences', () => {
      const preferences: UserPreference[] = [
        { type: 'technical_depth', value: 'beginner', source: '1' },
        { type: 'response_length', value: 'concise', source: '2' }
      ]
      const result = getPersonalizationPrompt(preferences)
      expect(result).toContain('简单易懂')
      expect(result).toContain('简洁')
    })
  })
})
