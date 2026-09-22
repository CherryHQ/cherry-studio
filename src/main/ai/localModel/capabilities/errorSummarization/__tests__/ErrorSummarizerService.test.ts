import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import * as modelServiceModule from '@main/data/services/ModelService'
import * as providerServiceModule from '@main/data/services/ProviderService'

import { ErrorSummarizerService } from '../ErrorSummarizerService'

vi.mock('@main/data/services/ProviderService')
vi.mock('@main/data/services/ModelService')

describe('ErrorSummarizerService', () => {
  let service: ErrorSummarizerService

  beforeEach(() => {
    vi.clearAllMocks()
    service = application.get('ErrorSummarizerService')
  })

  describe('summarizeError', () => {
    it('returns null when error output is empty', async () => {
      const result = await service.summarizeError('')
      expect(result).toBeNull()
    })

    it('returns null when error output is only whitespace', async () => {
      const result = await service.summarizeError('   \n  \t  ')
      expect(result).toBeNull()
    })

    it('returns null when no local model is available', async () => {
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'openai',
          name: 'OpenAI',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)

      const result = await service.summarizeError('Error: something failed')
      expect(result).toBeNull()
    })

    it('truncates error output if it exceeds maxLength', async () => {
      const aiServiceMock = {
        generateText: vi.fn().mockResolvedValue({ text: 'Summarized error' })
      }
      vi.mocked(application.get).mockReturnValue(aiServiceMock as any)
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'lmstudio',
          name: 'LM Studio',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)
      vi.mocked(modelServiceModule.modelService.list).mockReturnValue([{ id: 'model-1', name: 'Local Model' }] as any)

      const longError = 'a'.repeat(10000)
      await service.summarizeError(longError, 5000)

      const callArgs = vi.mocked(aiServiceMock.generateText).mock.calls[0]
      const promptArg = callArgs[0]
      expect(promptArg.prompt).toContain('... (truncated)')
    })

    it('returns null when generateText fails', async () => {
      const aiServiceMock = {
        generateText: vi.fn().mockRejectedValue(new Error('API error'))
      }
      vi.mocked(application.get).mockReturnValue(aiServiceMock as any)
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'lmstudio',
          name: 'LM Studio',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)
      vi.mocked(modelServiceModule.modelService.list).mockReturnValue([{ id: 'model-1', name: 'Local Model' }] as any)

      const result = await service.summarizeError('Error: something failed')
      expect(result).toBeNull()
    })

    it('returns null when generateText returns empty text', async () => {
      const aiServiceMock = {
        generateText: vi.fn().mockResolvedValue({ text: '' })
      }
      vi.mocked(application.get).mockReturnValue(aiServiceMock as any)
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'ollama',
          name: 'Ollama',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)
      vi.mocked(modelServiceModule.modelService.list).mockReturnValue([{ id: 'llama2', name: 'Llama 2' }] as any)

      const result = await service.summarizeError('Error: something failed')
      expect(result).toBeNull()
    })

    it('finds and uses Ollama local model', async () => {
      const aiServiceMock = {
        generateText: vi.fn().mockResolvedValue({ text: 'Summarized: API rate limit exceeded' })
      }
      vi.mocked(application.get).mockReturnValue(aiServiceMock as any)
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'ollama',
          name: 'Ollama',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)
      vi.mocked(modelServiceModule.modelService.list).mockReturnValue([{ id: 'llama2', name: 'Llama 2' }] as any)

      const result = await service.summarizeError('Error: API rate limit exceeded')
      expect(result).toBe('Summarized: API rate limit exceeded')

      const callArgs = vi.mocked(aiServiceMock.generateText).mock.calls[0]
      expect(callArgs[0].uniqueModelId).toBe('ollama::llama2')
    })

    it('finds and uses LM Studio local model', async () => {
      const aiServiceMock = {
        generateText: vi.fn().mockResolvedValue({ text: 'Summarized: Build failed' })
      }
      vi.mocked(application.get).mockReturnValue(aiServiceMock as any)
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'lmstudio',
          name: 'LM Studio',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)
      vi.mocked(modelServiceModule.modelService.list).mockReturnValue([{ id: 'mistral-7b', name: 'Mistral 7B' }] as any)

      const result = await service.summarizeError('Error: Build failed')
      expect(result).toBe('Summarized: Build failed')

      const callArgs = vi.mocked(aiServiceMock.generateText).mock.calls[0]
      expect(callArgs[0].uniqueModelId).toBe('lmstudio::mistral-7b')
    })

    it('builds summarization prompt correctly', async () => {
      const aiServiceMock = {
        generateText: vi.fn().mockResolvedValue({ text: 'Summary' })
      }
      vi.mocked(application.get).mockReturnValue(aiServiceMock as any)
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'ollama',
          name: 'Ollama',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)
      vi.mocked(modelServiceModule.modelService.list).mockReturnValue([{ id: 'model-1', name: 'Model' }] as any)

      const errorOutput = 'TypeError: Cannot read property of undefined'
      await service.summarizeError(errorOutput)

      const callArgs = vi.mocked(aiServiceMock.generateText).mock.calls[0]
      const prompt = callArgs[0].prompt
      expect(prompt).toContain('summarize this error output concisely')
      expect(prompt).toContain('What failed')
      expect(prompt).toContain('root cause')
      expect(prompt).toContain('error code')
      expect(prompt).toContain(errorOutput)
    })

    it('strips whitespace from summary', async () => {
      const aiServiceMock = {
        generateText: vi.fn().mockResolvedValue({ text: '  \n  Summarized  \n  ' })
      }
      vi.mocked(application.get).mockReturnValue(aiServiceMock as any)
      vi.mocked(providerServiceModule.providerService.list).mockReturnValue([
        {
          id: 'ollama',
          name: 'Ollama',
          defaultChatEndpoint: 'openai-chat-completions'
        }
      ] as any)
      vi.mocked(modelServiceModule.modelService.list).mockReturnValue([{ id: 'model-1', name: 'Model' }] as any)

      const result = await service.summarizeError('Error')
      expect(result).toBe('Summarized')
    })
  })
})
