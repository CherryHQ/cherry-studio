import { ipcApi } from '@renderer/ipc'
import { generateConversationSuggestions } from '@renderer/utils/aiGeneration'
import {
  type ConversationSuggestionRequestContext,
  parseConversationSuggestions
} from '@renderer/utils/conversationSuggestions'
import { readConversationSuggestionsModel } from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/utils/model', () => ({
  readConversationSuggestionsModel: vi.fn(),
  readDefaultModel: vi.fn(),
  readQuickModel: vi.fn()
}))

const model: Model = {
  id: 'openai::gpt-4o-mini',
  providerId: 'openai',
  apiModelId: 'gpt-4o-mini',
  name: 'GPT-4o mini',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const context: ConversationSuggestionRequestContext = {
  mode: 'agent',
  outputLanguage: 'zh-CN',
  systemLocale: 'en-US',
  localDateTime: 'Tuesday, August 11, 2026 at 3:15 PM',
  timeZone: 'America/Los_Angeles',
  randomSeed: 'seed-1',
  persona: { name: 'Code Reviewer', description: 'Reviews changes carefully' }
}

describe('conversation suggestion generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readConversationSuggestionsModel).mockResolvedValue(model)
  })

  it('uses the configured suggestions model and returns a strict three-item response', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue({ text: '{"suggestions":["检查改动","制定计划","补充验证"]}' })

    await expect(generateConversationSuggestions(context)).resolves.toEqual(['检查改动', '制定计划', '补充验证'])
    expect(ipcApi.request).toHaveBeenCalledWith('ai.text.generate', {
      uniqueModelId: model.id,
      system: expect.stringContaining('For agent mode'),
      prompt: JSON.stringify(context)
    })
  })

  it('fails before requesting generation when no configured or default model exists', async () => {
    vi.mocked(readConversationSuggestionsModel).mockResolvedValue(undefined)

    await expect(generateConversationSuggestions(context)).rejects.toThrow('No model available')
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong count', '{"suggestions":["one","two"]}'],
    ['duplicates', '{"suggestions":["same","same","other"]}'],
    ['blank suggestion', '{"suggestions":["one","  ","three"]}'],
    ['extra field', '{"suggestions":["one","two","three"],"extra":true}'],
    ['markdown wrapper', '```json\n{"suggestions":["one","two","three"]}\n```'],
    ['overlong suggestion', JSON.stringify({ suggestions: ['one', 'two', 'x'.repeat(97)] })]
  ])('rejects %s instead of accepting an unreliable model response', (_case, response) => {
    expect(() => parseConversationSuggestions(response)).toThrow()
  })
})
