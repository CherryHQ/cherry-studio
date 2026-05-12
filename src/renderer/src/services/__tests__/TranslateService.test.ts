import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  t: (key: string) => `t(${key})`
}))

import { translateText } from '../TranslateService'

/**
 * `translateText` is non-streaming since the v1 streaming chat-completion path
 * was removed during the Main IPC migration. The current flow:
 *   1. Resolve target language (string → DTO via DataApi, or accept TranslateLanguage)
 *   2. Read `feature.translate.model_id` preference + the model row from DataApi
 *   3. Build the prompt (Qwen MT models skip interpolation)
 *   4. Call `window.api.ai.generateText` once and return the trimmed text
 */

const TARGET = {
  langCode: parseTranslateLangCode('en-us'),
  value: 'English',
  emoji: '🇺🇸',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as TranslateLanguage

const TRANSLATE_MODEL_ID = 'openai::gpt-4o'
const TRANSLATE_PROMPT_TEMPLATE = 'Translate the following text to {{target_language}}: {{text}}'

interface MockAiApi {
  generateText: ReturnType<typeof vi.fn>
}

let originalApi: unknown
let mockAi: MockAiApi

beforeEach(() => {
  vi.mocked(preferenceService.get).mockImplementation(async (key: string) => {
    if (key === 'feature.translate.model_id') return TRANSLATE_MODEL_ID
    if (key === 'feature.translate.model_prompt') return TRANSLATE_PROMPT_TEMPLATE
    return null
  })

  vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
    if (path === `/models/${TRANSLATE_MODEL_ID}`) {
      // Minimal v2 SharedModel shape — `fromSharedModel` needs `id`, `providerId`, `name`,
      // `capabilities`. The id deliberately avoids the 'qwen-mt' substring so the
      // prompt-interpolation branch runs by default.
      return {
        id: TRANSLATE_MODEL_ID,
        providerId: 'openai',
        name: 'GPT-4o',
        capabilities: []
      } as any
    }
    if (path === '/translate/languages/en-us') {
      return TARGET as any
    }
    throw new Error(`Unexpected DataApi path in test: ${path}`)
  })

  mockAi = {
    generateText: vi.fn().mockResolvedValue({ text: 'Hello world' })
  }
  originalApi = (window as unknown as { api?: unknown }).api
  ;(window as unknown as { api: { ai: MockAiApi } }).api = {
    ...((originalApi ?? {}) as object),
    ai: mockAi
  } as { ai: MockAiApi }
})

afterEach(() => {
  ;(window as unknown as { api?: unknown }).api = originalApi
  vi.clearAllMocks()
})

describe('translateText', () => {
  describe('happy path', () => {
    it('returns the trimmed text from window.api.ai.generateText', async () => {
      mockAi.generateText.mockResolvedValueOnce({ text: '  Hello world  ' })

      await expect(translateText('source', TARGET)).resolves.toBe('Hello world')

      expect(mockAi.generateText).toHaveBeenCalledTimes(1)
      expect(mockAi.generateText).toHaveBeenCalledWith({
        uniqueModelId: TRANSLATE_MODEL_ID,
        prompt: 'Translate the following text to English: source'
      })
    })

    it('invokes onResponse exactly once with (text, true) on completion', async () => {
      const onResponse = vi.fn()
      mockAi.generateText.mockResolvedValueOnce({ text: 'Hi there' })

      await translateText('source', TARGET, onResponse)

      expect(onResponse).toHaveBeenCalledTimes(1)
      expect(onResponse).toHaveBeenCalledWith('Hi there', true)
    })
  })

  describe('target language resolution', () => {
    it('fetches the language DTO when given a string langCode', async () => {
      await translateText('source', parseTranslateLangCode('en-us'))

      expect(dataApiService.get).toHaveBeenCalledWith('/translate/languages/en-us')
    })

    it('throws when given an invalid string langCode without calling generateText', async () => {
      await expect(translateText('source', 'not-a-real-code' as any)).rejects.toThrow(
        'Invalid target language: not-a-real-code'
      )
      expect(mockAi.generateText).not.toHaveBeenCalled()
    })

    it('throws when given the "unknown" sentinel as target language', async () => {
      await expect(translateText('source', 'unknown' as any)).rejects.toThrow('Invalid target language: unknown')
      expect(dataApiService.get).not.toHaveBeenCalledWith('/translate/languages/unknown')
      expect(mockAi.generateText).not.toHaveBeenCalled()
    })
  })

  describe('not-configured guards', () => {
    it('throws translate.error.not_configured when the translate model preference is unset', async () => {
      vi.mocked(preferenceService.get).mockImplementation(async (key: string) => {
        if (key === 'feature.translate.model_id') return null
        if (key === 'feature.translate.model_prompt') return TRANSLATE_PROMPT_TEMPLATE
        return null
      })

      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.not_configured)')
      expect(mockAi.generateText).not.toHaveBeenCalled()
    })

    it('throws translate.error.not_configured when the model row is missing', async () => {
      vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
        if (path === `/models/${TRANSLATE_MODEL_ID}`) throw new Error('not found')
        return null as any
      })

      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.not_configured)')
      expect(mockAi.generateText).not.toHaveBeenCalled()
    })
  })

  describe('prompt construction', () => {
    it('interpolates {{target_language}} and {{text}} into the configured prompt', async () => {
      await translateText('hello', TARGET)

      expect(mockAi.generateText).toHaveBeenCalledWith({
        uniqueModelId: TRANSLATE_MODEL_ID,
        prompt: 'Translate the following text to English: hello'
      })
    })

    it('skips interpolation for Qwen MT models — sends the raw source text', async () => {
      const QWEN_MT_ID = 'dashscope::qwen-mt-turbo'
      vi.mocked(preferenceService.get).mockImplementation(async (key: string) => {
        if (key === 'feature.translate.model_id') return QWEN_MT_ID
        if (key === 'feature.translate.model_prompt') return TRANSLATE_PROMPT_TEMPLATE
        return null
      })
      vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
        if (path === `/models/${QWEN_MT_ID}`) {
          return {
            id: QWEN_MT_ID,
            providerId: 'dashscope',
            name: 'Qwen MT Turbo',
            capabilities: []
          } as any
        }
        throw new Error(`Unexpected DataApi path in test: ${path}`)
      })

      await translateText('原文', TARGET)

      expect(mockAi.generateText).toHaveBeenCalledWith({
        uniqueModelId: QWEN_MT_ID,
        prompt: '原文'
      })
    })
  })

  describe('empty output', () => {
    it('rejects with translate.error.empty when the model returns an empty string', async () => {
      mockAi.generateText.mockResolvedValueOnce({ text: '' })

      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.empty)')
    })

    it('rejects with translate.error.empty when the model returns whitespace only', async () => {
      mockAi.generateText.mockResolvedValueOnce({ text: '   \n  ' })

      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.empty)')
    })
  })
})
