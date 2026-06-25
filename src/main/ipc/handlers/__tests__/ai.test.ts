import { IpcError } from '@shared/ipc/errors'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { aiHandlers } from '../ai'

const aiService = {
  generateText: vi.fn(),
  checkModel: vi.fn(),
  embedMany: vi.fn(),
  runImageRequest: vi.fn(),
  abortImage: vi.fn(),
  listModels: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'AiService') return aiService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// AI handlers act on provider/model capabilities, not the caller's window, so they
// ignore IpcContext — pass a stable stub.
const ctx = { senderId: 'w1' }

describe('aiHandlers', () => {
  it('generate_text forwards the request and returns the AiService result', async () => {
    const request = { uniqueModelId: 'openai::gpt-4o', system: 'sys', prompt: 'hi' } as const
    const out = { text: 'hello', usage: { inputTokens: 1, outputTokens: 2 } }
    aiService.generateText.mockResolvedValue(out)

    const result = await aiHandlers['ai.generate_text'](request, ctx)

    expect(aiService.generateText).toHaveBeenCalledWith(request)
    expect(result).toBe(out)
  })

  it('check_model forwards the request and returns latency', async () => {
    aiService.checkModel.mockResolvedValue({ latency: 42 })
    const result = await aiHandlers['ai.check_model']({ uniqueModelId: 'openai::gpt-4o', timeout: 5000 }, ctx)
    expect(aiService.checkModel).toHaveBeenCalledWith({ uniqueModelId: 'openai::gpt-4o', timeout: 5000 })
    expect(result).toEqual({ latency: 42 })
  })

  it('embed_many forwards the request and returns embeddings', async () => {
    const out = { embeddings: [[0, 1]] }
    aiService.embedMany.mockResolvedValue(out)
    const result = await aiHandlers['ai.embed_many']({ uniqueModelId: 'openai::e', values: ['a'] }, ctx)
    expect(aiService.embedMany).toHaveBeenCalledWith({ uniqueModelId: 'openai::e', values: ['a'] })
    expect(result).toBe(out)
  })

  it('generate_image unwraps { requestId, payload } into runImageRequest', async () => {
    const payload = { uniqueModelId: 'openai::img' as const, prompt: 'a fox' }
    const out = { files: [] }
    aiService.runImageRequest.mockResolvedValue(out)

    const result = await aiHandlers['ai.generate_image']({ requestId: 'r1', payload }, ctx)

    expect(aiService.runImageRequest).toHaveBeenCalledWith('r1', payload)
    expect(result).toBe(out)
  })

  it('abort_image delegates to AiService.abortImage and resolves void', async () => {
    const result = await aiHandlers['ai.abort_image']({ requestId: 'r1' }, ctx)
    expect(aiService.abortImage).toHaveBeenCalledWith('r1')
    expect(result).toBeUndefined()
  })

  it('list_models forwards the request and returns the models', async () => {
    const models = [{ id: 'openai::gpt-4o' }]
    aiService.listModels.mockResolvedValue(models)
    const result = await aiHandlers['ai.list_models']({ providerId: 'openai', throwOnError: true }, ctx)
    expect(aiService.listModels).toHaveBeenCalledWith({ providerId: 'openai', throwOnError: true })
    expect(result).toBe(models)
  })

  // The point of the migration: a provider failure is re-thrown as an AI_REQUEST_FAILED
  // IpcError that carries the full SerializedError in `data`, so the renderer can read
  // detail Electron's invoke reject would otherwise drop.
  it('wraps a provider failure as an AI_REQUEST_FAILED IpcError carrying the serialized error', async () => {
    const failure = Object.assign(new Error('401 Unauthorized'), { statusCode: 401, responseBody: 'bad key' })
    aiService.generateText.mockRejectedValue(failure)

    const error = await aiHandlers['ai.generate_text']({ uniqueModelId: 'openai::gpt-4o', prompt: 'hi' }, ctx).catch(
      (e) => e
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_REQUEST_FAILED)
    expect(error.message).toBe('401 Unauthorized')
    // data is the SerializedError — provider detail survives the boundary.
    expect(error.data).toMatchObject({ message: '401 Unauthorized', statusCode: 401, responseBody: 'bad key' })
  })

  it('normalizes a non-Error throw into an AI_REQUEST_FAILED IpcError', async () => {
    aiService.checkModel.mockRejectedValue('boom')

    const error = await aiHandlers['ai.check_model']({ uniqueModelId: 'openai::gpt-4o' }, ctx).catch((e) => e)

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_REQUEST_FAILED)
    expect(error.message).toBe('boom')
  })
})
