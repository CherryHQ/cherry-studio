import type { Assistant, AssistantSettings, Model, Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { defaultTimeout } from '@shared/config/constant'
import { describe, expect, it, vi } from 'vitest'

import { getTemperature, getTimeout, getTopP } from '../modelParameters'

vi.mock('@renderer/services/AssistantService', () => ({
  getAssistantSettings: (assistant: Assistant): AssistantSettings => ({
    contextCount: assistant.settings?.contextCount ?? 4096,
    temperature: assistant.settings?.temperature ?? 0.7,
    enableTemperature: assistant.settings?.enableTemperature ?? true,
    topP: assistant.settings?.topP ?? 1,
    enableTopP: assistant.settings?.enableTopP ?? false,
    enableMaxTokens: assistant.settings?.enableMaxTokens ?? false,
    maxTokens: assistant.settings?.maxTokens,
    streamOutput: assistant.settings?.streamOutput ?? true,
    toolUseMode: assistant.settings?.toolUseMode ?? 'prompt',
    defaultModel: assistant.defaultModel,
    customParameters: assistant.settings?.customParameters ?? [],
    reasoning_effort: assistant.settings?.reasoning_effort ?? 'default',
    reasoning_effort_cache: assistant.settings?.reasoning_effort_cache,
    qwenThinkMode: assistant.settings?.qwenThinkMode
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn(),
  useSettings: vi.fn(() => ({})),
  useNavbarPosition: vi.fn(() => ({ navbarPosition: 'left', isLeftNavbar: true, isTopNavbar: false }))
}))

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('@renderer/store/settings', () => ({
  default: (state = { settings: {} }) => state
}))

vi.mock('@renderer/store/assistants', () => ({
  default: (state = { assistants: [] }) => state
}))

const createTopic = (assistantId: string): Topic => ({
  id: `topic-${assistantId}`,
  assistantId,
  name: 'topic',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [],
  type: TopicType.Chat
})

const createAssistant = (settings: Assistant['settings'] = {}): Assistant => {
  const assistantId = 'assistant-1'
  return {
    id: assistantId,
    name: 'Test Assistant',
    prompt: 'prompt',
    topics: [createTopic(assistantId)],
    type: 'assistant',
    settings
  }
}

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o',
  provider: 'openai',
  name: 'GPT-4o',
  group: 'openai',
  ...overrides
})

describe('modelParameters', () => {
  describe('getTemperature', () => {
    it('returns undefined when reasoning effort is enabled for Claude models', () => {
      const assistant = createAssistant({ reasoning_effort: 'medium' })
      const model = createModel({ id: 'claude-opus-4', name: 'Claude Opus 4', provider: 'anthropic', group: 'claude' })

      expect(getTemperature(assistant, model)).toBeUndefined()
    })

    it('returns undefined for models without temperature/topP support', () => {
      const assistant = createAssistant({ enableTemperature: true })
      const model = createModel({ id: 'qwen-mt-large', name: 'Qwen MT', provider: 'qwen', group: 'qwen' })

      expect(getTemperature(assistant, model)).toBeUndefined()
    })

    it('returns undefined for Claude 4.5 reasoning models when only TopP is enabled', () => {
      const assistant = createAssistant({ enableTopP: true, enableTemperature: false })
      const model = createModel({
        id: 'claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        group: 'claude'
      })

      expect(getTemperature(assistant, model)).toBeUndefined()
    })

    it('returns configured temperature when enabled', () => {
      const assistant = createAssistant({ enableTemperature: true, temperature: 0.42 })
      const model = createModel({ id: 'gpt-4o', provider: 'openai', group: 'openai' })

      expect(getTemperature(assistant, model)).toBe(0.42)
    })

    it('returns undefined when temperature is disabled', () => {
      const assistant = createAssistant({ enableTemperature: false, temperature: 0.9 })
      const model = createModel({ id: 'gpt-4o', provider: 'openai', group: 'openai' })

      expect(getTemperature(assistant, model)).toBeUndefined()
    })

    it('clamps temperature to max 1.0 for Zhipu models', () => {
      const assistant = createAssistant({ enableTemperature: true, temperature: 2.0 })
      const model = createModel({ id: 'glm-4-plus', name: 'GLM-4 Plus', provider: 'zhipu', group: 'zhipu' })

      expect(getTemperature(assistant, model)).toBe(1.0)
    })

    it('clamps temperature to max 1.0 for Anthropic models', () => {
      const assistant = createAssistant({ enableTemperature: true, temperature: 1.5 })
      const model = createModel({
        id: 'claude-sonnet-3.5',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        group: 'claude'
      })

      expect(getTemperature(assistant, model)).toBe(1.0)
    })

    it('clamps temperature to max 1.0 for Moonshot models', () => {
      const assistant = createAssistant({ enableTemperature: true, temperature: 2.0 })
      const model = createModel({
        id: 'moonshot-v1-8k',
        name: 'Moonshot v1 8k',
        provider: 'moonshot',
        group: 'moonshot'
      })

      expect(getTemperature(assistant, model)).toBe(1.0)
    })

    it('does not clamp temperature for OpenAI models', () => {
      const assistant = createAssistant({ enableTemperature: true, temperature: 2.0 })
      const model = createModel({ id: 'gpt-4o', provider: 'openai', group: 'openai' })

      expect(getTemperature(assistant, model)).toBe(2.0)
    })

    it('does not clamp temperature when it is already within limits', () => {
      const assistant = createAssistant({ enableTemperature: true, temperature: 0.8 })
      const model = createModel({ id: 'glm-4-plus', name: 'GLM-4 Plus', provider: 'zhipu', group: 'zhipu' })

      expect(getTemperature(assistant, model)).toBe(0.8)
    })
  })

  describe('getTopP', () => {
    it('returns undefined when reasoning effort is enabled for Claude models', () => {
      const assistant = createAssistant({ reasoning_effort: 'high' })
      const model = createModel({ id: 'claude-opus-4', provider: 'anthropic', group: 'claude' })

      expect(getTopP(assistant, model)).toBeUndefined()
    })

    it('returns undefined for models without TopP support', () => {
      const assistant = createAssistant({ enableTopP: true })
      const model = createModel({ id: 'qwen-mt-small', name: 'Qwen MT', provider: 'qwen', group: 'qwen' })

      expect(getTopP(assistant, model)).toBeUndefined()
    })

    it('returns undefined for Claude 4.5 reasoning models when temperature is enabled', () => {
      const assistant = createAssistant({ enableTemperature: true })
      const model = createModel({
        id: 'claude-opus-4.5',
        name: 'Claude Opus 4.5',
        provider: 'anthropic',
        group: 'claude'
      })

      expect(getTopP(assistant, model)).toBeUndefined()
    })

    it('returns configured TopP when enabled', () => {
      const assistant = createAssistant({ enableTopP: true, topP: 0.73 })
      const model = createModel({ id: 'gpt-4o', provider: 'openai', group: 'openai' })

      expect(getTopP(assistant, model)).toBe(0.73)
    })

    it('returns undefined when TopP is disabled', () => {
      const assistant = createAssistant({ enableTopP: false, topP: 0.5 })
      const model = createModel({ id: 'gpt-4o', provider: 'openai', group: 'openai' })

      expect(getTopP(assistant, model)).toBeUndefined()
    })
  })

  describe('getTimeout', () => {
    it('uses an extended timeout for flex service tier models', () => {
      const model = createModel({ id: 'o3-pro', provider: 'openai', group: 'openai' })

      expect(getTimeout(model)).toBe(15 * 1000 * 60)
    })

    it('falls back to the default timeout otherwise', () => {
      const model = createModel({ id: 'gpt-4o', provider: 'openai', group: 'openai' })

      expect(getTimeout(model)).toBe(defaultTimeout)
    })
  })
})
