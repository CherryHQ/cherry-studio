import type { StreamListener } from '@main/ai/streamManager/types'
import { createUniqueModelId } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the gateway model-id contract: `model` is `providerId:modelId`, split on
 * the FIRST `:` (v1 used `::`). See the breaking-changes entry
 * `2026-06-06-api-gateway-model-id-separator.md`.
 */

const { mockStreamPrompt, captured } = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  captured: { opts: undefined as { uniqueModelId?: string; listener?: StreamListener } | undefined }
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn((name: string) =>
      name === 'AiStreamManager' ? { streamPrompt: mockStreamPrompt, abort: vi.fn() } : undefined
    )
  }
}))
vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: vi.fn(async () => undefined) }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }
}))
vi.mock('../adapters', () => ({
  MessageConverterFactory: {
    create: () => ({
      toUIMessages: () => [],
      toAiSdkTools: () => undefined,
      extractStreamOptions: () => ({}),
      extractProviderOptions: () => undefined
    })
  },
  StreamAdapterFactory: {
    createAdapter: () => ({
      transformChunk: () => [],
      finalizeEvents: () => [],
      buildNonStreamingResponse: () => ({ ok: true })
    }),
    getFormatter: () => ({ formatEvent: () => '', formatDone: () => '' })
  }
}))

import { processMessage } from '../proxyStream'

beforeEach(() => {
  vi.clearAllMocks()
  captured.opts = undefined
  mockStreamPrompt.mockImplementation((opts) => {
    captured.opts = opts
  })
})

/** Resolve a valid (non-streaming) request after capturing the streamPrompt args. */
async function resolveValid(model: string): Promise<string | undefined> {
  const promise = processMessage({
    params: { model, messages: [] } as any,
    inputFormat: 'openai',
    outputFormat: 'openai'
  })
  await vi.waitFor(() => expect(captured.opts).toBeDefined())
  const uniqueModelId = captured.opts!.uniqueModelId
  void captured.opts!.listener!.onDone({} as any)
  await promise
  return uniqueModelId
}

describe('processMessage model-id parsing', () => {
  it('rejects a missing model field', async () => {
    await expect(
      processMessage({ params: { messages: [] } as any, inputFormat: 'openai', outputFormat: 'openai' })
    ).rejects.toThrow(/missing a "model"/)
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('rejects a non-string model field', async () => {
    await expect(
      processMessage({ params: { model: 123, messages: [] } as any, inputFormat: 'openai', outputFormat: 'openai' })
    ).rejects.toThrow(/missing a "model"/)
  })

  it('rejects a leading-colon model (empty providerId)', async () => {
    await expect(
      processMessage({
        params: { model: ':gpt-4', messages: [] } as any,
        inputFormat: 'openai',
        outputFormat: 'openai'
      })
    ).rejects.toThrow(/Invalid model format/)
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('rejects a trailing-colon model (empty modelId)', async () => {
    await expect(
      processMessage({
        params: { model: 'openai:', messages: [] } as any,
        inputFormat: 'openai',
        outputFormat: 'openai'
      })
    ).rejects.toThrow(/Invalid model format/)
  })

  it('rejects a model with no separator', async () => {
    await expect(
      processMessage({ params: { model: 'gpt-4', messages: [] } as any, inputFormat: 'openai', outputFormat: 'openai' })
    ).rejects.toThrow(/Invalid model format/)
  })

  it('rejects the managed CherryAI default model', async () => {
    await expect(
      processMessage({
        params: { model: 'cherryai:qwen', messages: [] } as any,
        inputFormat: 'openai',
        outputFormat: 'openai'
      })
    ).rejects.toThrow(/not available through the API gateway/)
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('splits on the first colon for a simple provider:model', async () => {
    expect(await resolveValid('openai:gpt-4')).toBe(createUniqueModelId('openai', 'gpt-4'))
  })

  it('keeps later colons in the model id (split on FIRST colon only)', async () => {
    expect(await resolveValid('openrouter:anthropic/claude:beta')).toBe(
      createUniqueModelId('openrouter', 'anthropic/claude:beta')
    )
  })
})
