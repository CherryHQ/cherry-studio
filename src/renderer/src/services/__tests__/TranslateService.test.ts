import { dataApiService } from '@data/DataApiService'
import type { TranslateLanguageVo } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { NoOutputGeneratedError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  t: (key: string) => `t(${key})`
}))

const fetchChatCompletionMock = vi.fn<(args: { onChunkReceived: (chunk: Chunk) => void }) => Promise<void>>()
vi.mock('@renderer/services/ApiService', () => ({
  fetchChatCompletion: (args: any) => fetchChatCompletionMock(args)
}))

const getDefaultTranslateAssistantMock = vi.fn(async () => ({
  id: 'translate-assistant',
  content: 'translate this'
}))
vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultTranslateAssistant: (...args: any[]) => getDefaultTranslateAssistantMock(...args)
}))

const readyToAbortMock = vi.fn(() => ({ aborted: false }) as AbortSignal)
vi.mock('@renderer/utils/abortController', () => ({
  readyToAbort: (key: string) => readyToAbortMock(key)
}))

const isAbortErrorMock = vi.fn<(e: unknown) => boolean>()
vi.mock('@renderer/utils/error', () => ({
  isAbortError: (e: unknown) => isAbortErrorMock(e)
}))

import { translateText } from '../TranslateService'

const TARGET: TranslateLanguageVo = { langCode: 'en-us', value: 'English', emoji: '🇺🇸' }

const streamChunks = (chunks: Chunk[]) =>
  fetchChatCompletionMock.mockImplementationOnce(async ({ onChunkReceived }) => {
    chunks.forEach(onChunkReceived)
  })

beforeEach(() => {
  vi.clearAllMocks()
  isAbortErrorMock.mockReturnValue(false)
})

describe('translateText', () => {
  describe('happy path', () => {
    it('resolves with the trimmed accumulated text from streaming chunks', async () => {
      streamChunks([
        { type: ChunkType.TEXT_DELTA, text: 'Hello' } as Chunk,
        { type: ChunkType.TEXT_DELTA, text: 'Hello world  ' } as Chunk,
        { type: ChunkType.TEXT_COMPLETE } as Chunk
      ])

      await expect(translateText('source', TARGET)).resolves.toBe('Hello world')
    })

    it('passes the abort signal through when an abortKey is provided', async () => {
      streamChunks([{ type: ChunkType.TEXT_DELTA, text: 'ok' } as Chunk])

      await translateText('source', TARGET, undefined, 'abort-key-1')

      expect(readyToAbortMock).toHaveBeenCalledWith('abort-key-1')
    })
  })

  describe('error chunks', () => {
    it('rejects when a non-abort ChunkType.ERROR arrives', async () => {
      const chunkError = new Error('upstream boom')
      streamChunks([{ type: ChunkType.ERROR, error: chunkError } as Chunk])

      await expect(translateText('source', TARGET)).rejects.toBe(chunkError)
    })

    it('rejects with the abort error when ChunkType.ERROR is an abort', async () => {
      const abortError = new Error('aborted by user')
      isAbortErrorMock.mockImplementation((e) => e === abortError)
      streamChunks([
        { type: ChunkType.TEXT_DELTA, text: 'partial' } as Chunk,
        { type: ChunkType.ERROR, error: abortError } as Chunk
      ])

      await expect(translateText('source', TARGET)).rejects.toBe(abortError)
    })
  })

  describe('NoOutputGeneratedError handling', () => {
    it('resolves with prior accumulated text when fetchChatCompletion throws NoOutputGeneratedError', async () => {
      // First emit a delta, then throw the abort-as-NoOutput error from the SDK.
      fetchChatCompletionMock.mockImplementationOnce(async ({ onChunkReceived }) => {
        onChunkReceived({ type: ChunkType.TEXT_DELTA, text: 'partial output  ' } as Chunk)
        throw new NoOutputGeneratedError({})
      })

      await expect(translateText('source', TARGET)).resolves.toBe('partial output')
    })

    it('rethrows non-NoOutputGeneratedError errors from fetchChatCompletion', async () => {
      const networkError = new Error('network down')
      fetchChatCompletionMock.mockRejectedValueOnce(networkError)

      await expect(translateText('source', TARGET)).rejects.toBe(networkError)
    })
  })

  describe('empty output', () => {
    it('rejects with translate.error.empty when no text was streamed', async () => {
      streamChunks([])

      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.empty)')
    })

    it('rejects with translate.error.empty when streamed text is whitespace only', async () => {
      streamChunks([{ type: ChunkType.TEXT_DELTA, text: '   \n  ' } as Chunk])

      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.empty)')
    })

    it('still rejects with empty when NoOutputGeneratedError fires with no prior text', async () => {
      fetchChatCompletionMock.mockImplementationOnce(async () => {
        throw new NoOutputGeneratedError({})
      })

      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.empty)')
    })
  })

  describe('target language resolution', () => {
    it('fetches the language DTO when given a string langCode', async () => {
      vi.mocked(dataApiService.get).mockResolvedValueOnce({
        langCode: 'en-us',
        value: 'English',
        emoji: '🇺🇸'
      } as any)
      streamChunks([{ type: ChunkType.TEXT_DELTA, text: 'ok' } as Chunk])

      await translateText('source', 'en-us')

      expect(dataApiService.get).toHaveBeenCalledWith('/translate/languages/en-us')
    })

    it('throws when given an invalid string langCode', async () => {
      await expect(translateText('source', 'not-a-real-code' as any)).rejects.toThrow(
        'Invalid target language: not-a-real-code'
      )
      expect(fetchChatCompletionMock).not.toHaveBeenCalled()
    })
  })

  describe('streaming callback', () => {
    it('forwards each delta to onResponse with the running text and completion flag', async () => {
      const onResponse = vi.fn()
      streamChunks([
        { type: ChunkType.TEXT_DELTA, text: 'Hi' } as Chunk,
        { type: ChunkType.TEXT_DELTA, text: 'Hi there' } as Chunk,
        { type: ChunkType.TEXT_COMPLETE } as Chunk
      ])

      await translateText('source', TARGET, onResponse)

      expect(onResponse).toHaveBeenNthCalledWith(1, 'Hi', false)
      expect(onResponse).toHaveBeenNthCalledWith(2, 'Hi there', false)
      expect(onResponse).toHaveBeenNthCalledWith(3, 'Hi there', true)
    })
  })
})
