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

const aiStreamManager = {
  dispatch: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  abort: vi.fn()
}

// WebContentsListener (constructed in the stream_open handler) wires once()/isDestroyed().
const fakeWebContents = { id: 1, once: vi.fn(), isDestroyed: () => false, send: vi.fn() }
const windowManager = { getWindow: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  windowManager.getWindow.mockReturnValue({ webContents: fakeWebContents })
  appGetMock.mockImplementation((name: string) => {
    switch (name) {
      case 'AiService':
        return aiService
      case 'AiStreamManager':
        return aiStreamManager
      case 'WindowManager':
        return windowManager
      default:
        throw new Error(`Unexpected application.get(${name})`)
    }
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

describe('aiHandlers — streaming', () => {
  it('stream_open resolves the sender WebContents and dispatches to AiStreamManager', async () => {
    const req = { trigger: 'submit-message', topicId: 't', userMessageParts: [] } as never
    aiStreamManager.dispatch.mockResolvedValue({ mode: 'started' })

    const result = await aiHandlers['ai.stream_open'](req, { senderId: 'w1' })

    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(aiStreamManager.dispatch).toHaveBeenCalledTimes(1)
    // Second arg is the parsed request; first is the freshly built WebContentsListener.
    expect(aiStreamManager.dispatch.mock.calls[0][1]).toBe(req)
    expect(result).toEqual({ mode: 'started' })
  })

  it('stream_open throws when the sender is not a managed window', async () => {
    windowManager.getWindow.mockReturnValue(undefined)
    await expect(aiHandlers['ai.stream_open']({ topicId: 't' } as never, { senderId: null })).rejects.toThrow(
      'requires a managed window'
    )
    expect(aiStreamManager.dispatch).not.toHaveBeenCalled()
  })

  it('stream_attach delegates to AiStreamManager.attach and returns its response', async () => {
    aiStreamManager.attach.mockReturnValue({ status: 'not-found' })

    const result = await aiHandlers['ai.stream_attach']({ topicId: 't' }, { senderId: 'w1' })

    expect(aiStreamManager.attach).toHaveBeenCalledWith(fakeWebContents, { topicId: 't' })
    expect(result).toEqual({ status: 'not-found' })
  })

  it('stream_detach delegates when the sender window exists', async () => {
    await aiHandlers['ai.stream_detach']({ topicId: 't' }, { senderId: 'w1' })
    expect(aiStreamManager.detach).toHaveBeenCalledWith(fakeWebContents, { topicId: 't' })
  })

  it('stream_detach is a no-op when the sender window is gone', async () => {
    windowManager.getWindow.mockReturnValue(undefined)
    await aiHandlers['ai.stream_detach']({ topicId: 't' }, { senderId: 'w1' })
    expect(aiStreamManager.detach).not.toHaveBeenCalled()
  })

  it('stream_abort aborts the topic without resolving a WebContents', async () => {
    await aiHandlers['ai.stream_abort']({ topicId: 't' }, { senderId: null })
    expect(aiStreamManager.abort).toHaveBeenCalledWith('t', 'user-requested')
    expect(windowManager.getWindow).not.toHaveBeenCalled()
  })
})
