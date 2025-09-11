import { Assistant } from '@renderer/types'
import { cloneDeep } from 'lodash'
import { describe, expect, it } from 'vitest'

import { isToolUseModeFunction } from '../assistant'

describe('assistant', () => {
  const assistant: Assistant = {
    id: 'assistant',
    name: 'assistant',
    prompt: '',
    topics: [],
    type: ''
  }

  describe('isToolUseModeFunction', () => {
    it('should detect function tool use mode', () => {
      const mockAssistant = cloneDeep(assistant)
      mockAssistant.settings = { toolUseMode: 'function' }
      expect(isToolUseModeFunction(mockAssistant)).toBe(true)
    })

    it('should detect non-function tool use mode', () => {
      const mockAssistant = cloneDeep(assistant)
      mockAssistant.settings = { toolUseMode: 'prompt' }
      expect(isToolUseModeFunction(mockAssistant)).toBe(false)
    })

    it('should handle undefined settings', () => {
      const mockAssistant = cloneDeep(assistant)
      expect(isToolUseModeFunction(mockAssistant)).toBe(false)
    })

    it('should handle undefined toolUseMode', () => {
      const mockAssistant = cloneDeep(assistant)
      mockAssistant.settings = {}
      expect(isToolUseModeFunction(mockAssistant)).toBe(false)
    })
  })
})
