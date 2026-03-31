import type { SerializedError } from '@renderer/types/error'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fetchGenerate and fetchModels
vi.mock('../ApiService', () => ({
  fetchGenerate: vi.fn(),
  fetchModels: vi.fn().mockResolvedValue([])
}))

// Mock CHERRYAI_PROVIDER
vi.mock('@renderer/config/providers', () => ({
  CHERRYAI_PROVIDER: { id: 'cherryai', type: 'openai', apiHost: 'https://api.cherry-ai.com', models: [] }
}))

// Mock store
vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({
      llm: { defaultModel: null }
    })),
    dispatch: vi.fn()
  },
  useAppSelector: vi.fn()
}))

// Mock LoggerService
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

import store from '@renderer/store'

import { fetchGenerate, fetchModels } from '../ApiService'
import { diagnoseError } from '../ErrorDiagnosisService'

const mockFetchGenerate = vi.mocked(fetchGenerate)
const mockFetchModels = vi.mocked(fetchModels)
const mockGetState = vi.mocked(store.getState)

function makeError(overrides: Partial<SerializedError> = {}): SerializedError {
  return { name: 'Error', message: 'test error', stack: null, ...overrides }
}

describe('ErrorDiagnosisService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetState.mockReturnValue({
      llm: { defaultModel: null }
    } as any)
    // Default: CherryAI returns a free model as fallback
    mockFetchModels.mockResolvedValue([{ id: 'qwen', name: 'Qwen', provider: 'cherryai' }] as any)
  })

  describe('diagnoseError', () => {
    it('returns parsed diagnosis result from AI', async () => {
      const mockResult = {
        summary: 'Auth error',
        category: 'authentication',
        explanation: 'Your API key is invalid.',
        steps: [{ text: 'Check your API key', nav: '/settings/provider' }]
      }
      mockFetchGenerate.mockResolvedValue(JSON.stringify(mockResult))

      const result = await diagnoseError(makeError(), 'en')
      expect(result.summary).toBe('Auth error')
      expect(result.category).toBe('authentication')
      expect(result.steps).toHaveLength(1)
    })

    it('strips markdown code blocks from response', async () => {
      const mockResult = {
        summary: 'Network error',
        category: 'network',
        explanation: 'Connection refused.',
        steps: [{ text: 'Check proxy' }]
      }
      mockFetchGenerate.mockResolvedValue('```json\n' + JSON.stringify(mockResult) + '\n```')

      const result = await diagnoseError(makeError(), 'en')
      expect(result.summary).toBe('Network error')
    })

    it('throws on empty response from all models', async () => {
      mockFetchGenerate.mockResolvedValue('')
      await expect(diagnoseError(makeError(), 'en')).rejects.toThrow()
    })

    it('throws on invalid JSON from all models', async () => {
      mockFetchGenerate.mockResolvedValue('not valid json')
      await expect(diagnoseError(makeError(), 'en')).rejects.toThrow()
    })

    it('throws on missing required fields', async () => {
      mockFetchGenerate.mockResolvedValue(JSON.stringify({ foo: 'bar' }))
      await expect(diagnoseError(makeError(), 'en')).rejects.toThrow('Invalid diagnosis response format')
    })

    it('uses CherryAI free model as primary', async () => {
      const customModel = { id: 'gpt-4', name: 'GPT-4', provider: 'openai' }
      mockGetState.mockReturnValue({ llm: { defaultModel: customModel } } as any)

      const mockResult = {
        summary: 'Error',
        category: 'unknown',
        explanation: 'Something went wrong.',
        steps: []
      }
      mockFetchGenerate.mockResolvedValue(JSON.stringify(mockResult))

      await diagnoseError(makeError(), 'en')
      // First call should use CherryAI free model (primary), not defaultModel
      expect(mockFetchGenerate.mock.calls[0][0]).toEqual(
        expect.objectContaining({ model: expect.objectContaining({ id: 'qwen' }) })
      )
    })

    it('falls back to defaultModel when CherryAI is unavailable', async () => {
      mockFetchModels.mockResolvedValue([])
      const customModel = { id: 'gpt-4', name: 'GPT-4', provider: 'openai' }
      mockGetState.mockReturnValue({ llm: { defaultModel: customModel } } as any)

      const mockResult = {
        summary: 'Error',
        category: 'unknown',
        explanation: 'Something went wrong.',
        steps: []
      }
      mockFetchGenerate.mockResolvedValue(JSON.stringify(mockResult))

      await diagnoseError(makeError(), 'en')
      expect(mockFetchGenerate.mock.calls[0][0]).toEqual(expect.objectContaining({ model: customModel }))
    })

    it('uses only CherryAI when no default model', async () => {
      mockGetState.mockReturnValue({ llm: { defaultModel: null } } as any)

      const mockResult = {
        summary: 'Error',
        category: 'unknown',
        explanation: 'Something went wrong.',
        steps: []
      }
      mockFetchGenerate.mockResolvedValue(JSON.stringify(mockResult))

      await diagnoseError(makeError(), 'en')
      expect(mockFetchGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ id: 'qwen' })
        })
      )
    })

    it('includes context in error info', async () => {
      const mockResult = {
        summary: 'Error',
        category: 'unknown',
        explanation: 'Something went wrong.',
        steps: []
      }
      mockFetchGenerate.mockResolvedValue(JSON.stringify(mockResult))

      await diagnoseError(makeError({ statusCode: 401 }), 'zh-CN', {
        errorSource: 'chat',
        providerName: 'openai',
        modelId: 'gpt-4'
      })

      const callArgs = mockFetchGenerate.mock.calls[0][0]
      expect(callArgs.content).toContain('openai')
      expect(callArgs.content).toContain('gpt-4')
      expect(callArgs.content).toContain('401')
    })

    it('defaults category to unknown when missing', async () => {
      mockFetchGenerate.mockResolvedValue(
        JSON.stringify({
          summary: 'Error',
          explanation: 'Something went wrong.',
          steps: []
        })
      )

      const result = await diagnoseError(makeError(), 'en')
      expect(result.category).toBe('unknown')
    })
  })
})
