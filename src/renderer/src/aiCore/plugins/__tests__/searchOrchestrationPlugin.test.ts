import type { Assistant, Model, Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchGenerate, mockGetProviderByModel } = vi.hoisted(() => ({
  mockFetchGenerate: vi.fn(),
  mockGetProviderByModel: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchGenerate: mockFetchGenerate
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultModel: vi.fn(),
  getProviderByModel: mockGetProviderByModel
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({}))
  }
}))

vi.mock('@renderer/store/memory', () => ({
  selectCurrentUserId: vi.fn(),
  selectGlobalMemoryEnabled: vi.fn(() => false),
  selectMemoryConfig: vi.fn()
}))

vi.mock('../../../services/MemoryProcessor', () => ({
  MemoryProcessor: class {}
}))

vi.mock('../../tools/KnowledgeSearchTool', () => ({
  knowledgeSearchTool: vi.fn()
}))

vi.mock('../../tools/MemorySearchTool', () => ({
  memorySearchTool: vi.fn()
}))

vi.mock('../../tools/WebSearchTool', () => ({
  BUILTIN_WEB_SEARCH_TOOL_NAME: 'builtin_web_search',
  webSearchToolWithPreExtractedKeywords: vi.fn()
}))

import { fetchGenerate } from '@renderer/services/ApiService'

import { searchOrchestrationPlugin } from '../searchOrchestrationPlugin'

describe('searchOrchestrationPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchGenerate.mockResolvedValue('')
    mockGetProviderByModel.mockReturnValue({ id: 'provider', apiKey: 'test-key' } as Provider)
  })

  it('sends the formatted search prompt as user content', async () => {
    const model = { id: 'test-model', provider: 'provider', name: 'Test Model', group: 'test' } as Model
    const assistant = {
      id: 'assistant',
      name: 'Test Assistant',
      prompt: '',
      topics: [],
      type: 'assistant',
      model,
      webSearchProviderId: 'tavily'
    } as Assistant
    const plugin = searchOrchestrationPlugin(assistant, 'topic-id')

    await plugin.onRequestStart?.({
      requestId: 'request-id',
      originalParams: {
        messages: [
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: 'current question' }
        ]
      }
    } as never)

    expect(fetchGenerate).toHaveBeenCalledOnce()
    expect(fetchGenerate).toHaveBeenCalledWith({
      model,
      prompt: '',
      content: expect.stringContaining('assistant: previous answer')
    })
    expect(mockFetchGenerate.mock.calls[0][0].content).toContain('current question')
  })
})
