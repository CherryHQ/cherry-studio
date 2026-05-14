import type { Assistant, AssistantSettings } from '@renderer/types'
import { cloneDeep } from 'lodash'
import { describe, expect, it } from 'vitest'

import { isToolUseModeFunction } from '../assistant'

const DEFAULT_SETTINGS: AssistantSettings = {
  temperature: 1,
  enableTemperature: false,
  topP: 1,
  enableTopP: false,
  maxTokens: 4096,
  enableMaxTokens: false,
  streamOutput: true,
  reasoning_effort: 'default',
  mcpMode: 'auto',
  toolUseMode: 'function',
  maxToolCalls: 20,
  enableMaxToolCalls: true,
  enableWebSearch: false,
  customParameters: []
}

describe('assistant', () => {
  const assistant: Assistant = {
    id: 'assistant',
    name: 'assistant',
    prompt: '',
    emoji: '🌟',
    description: '',
    settings: DEFAULT_SETTINGS,
    modelId: null,
    modelName: null,
    orderKey: 'a0',
    mcpServerIds: [],
    knowledgeBaseIds: [],
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  describe('isToolUseModeFunction', () => {
    it('should detect function tool use mode', () => {
      const mockAssistant = cloneDeep(assistant)
      mockAssistant.settings = { ...DEFAULT_SETTINGS, toolUseMode: 'function' }
      expect(isToolUseModeFunction(mockAssistant)).toBe(true)
    })

    it('should detect non-function tool use mode', () => {
      const mockAssistant = cloneDeep(assistant)
      mockAssistant.settings = { ...DEFAULT_SETTINGS, toolUseMode: 'prompt' }
      expect(isToolUseModeFunction(mockAssistant)).toBe(false)
    })

    it('should default to function when settings carry the schema default', () => {
      // v2 settings is non-nullable and `toolUseMode` defaults to 'function'.
      // The v1 "undefined settings" / "undefined toolUseMode" cases are gone:
      // any v2 Assistant has a fully-populated settings object.
      const mockAssistant = cloneDeep(assistant)
      expect(isToolUseModeFunction(mockAssistant)).toBe(true)
    })
  })
})
