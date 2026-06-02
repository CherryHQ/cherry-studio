import { BaseService } from '@main/core/lifecycle/BaseService'
import type { AiToolApprovalRespondResponse } from '@shared/ai/transport'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateImage = vi.fn()
const mockDownloadImageAsBase64 = vi.fn()
const mockApplicationGet = vi.fn()
const mockMessageGetById = vi.fn()
const mockMessageUpdate = vi.fn()
const mockListSessionMessages = vi.fn()
const mockSaveSessionMessage = vi.fn()

vi.mock('@main/core/application', () => ({
  application: {
    get: mockApplicationGet
  }
}))

vi.mock('@main/utils/downloadAsBase64', () => ({
  downloadImageAsBase64: (...args: unknown[]) => mockDownloadImageAsBase64(...args)
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    getById: mockMessageGetById,
    update: mockMessageUpdate
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: mockListSessionMessages,
    saveMessage: mockSaveSessionMessage
  }
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: vi.fn(),
  embedMany: vi.fn(),
  generateImage: (...args: unknown[]) => mockGenerateImage(...args)
}))

const { AiService } = await import('../AiService')

/**
 * Instantiate `AiService` directly (without going through the lifecycle
 * container) so unit tests can drive its methods in isolation.
 */
function createService(): InstanceType<typeof AiService> {
  BaseService.resetInstances()
  return new (AiService as any)()
}

function getToolApprovalHandler() {
  return vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([channel]) => channel === IpcChannel.Ai_ToolApproval_Respond)?.[1] as
    | ((event: { sender: unknown }, payload: Record<string, unknown>) => Promise<AiToolApprovalRespondResponse>)
    | undefined
}

describe('AiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes agent-session runtime requests directly to the runtime service', async () => {
    const service = createService()
    const stream = new ReadableStream()
    const openTurnStream = vi.fn(() => stream)
    mockApplicationGet.mockReturnValue({ openTurnStream })

    await expect(
      service.streamText({
        chatId: 'agent-session:session-1',
        trigger: 'submit-message',
        runtime: { kind: 'agent-session', sessionId: 'session-1', turnId: 'turn-1' },
        requestOptions: { signal: new AbortController().signal }
      } as any)
    ).resolves.toBe(stream)

    expect(mockApplicationGet).toHaveBeenCalledWith('AgentSessionRuntimeService')
    expect(openTurnStream).toHaveBeenCalledWith({
      sessionId: 'session-1',
      turnId: 'turn-1',
      signal: expect.any(AbortSignal)
    })
  })

  it('rejects agent-session streams that do not carry a runtime request', async () => {
    const service = createService()
    const buildAgentParamsFor = vi.spyOn(service as any, 'buildAgentParamsFor')

    await expect(
      service.streamText({
        chatId: 'agent-session:session-1',
        trigger: 'submit-message',
        requestOptions: { signal: new AbortController().signal }
      } as any)
    ).rejects.toThrow('requires an agent-session runtime request')

    expect(buildAgentParamsFor).not.toHaveBeenCalled()
    expect(mockApplicationGet).not.toHaveBeenCalled()
  })

  it('normalizes base64 and url images from ai-core generateImage', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-model'
      }
    } as never)

    mockGenerateImage.mockResolvedValue({
      images: [{ base64: 'abc123', mediaType: 'image/png' }, { nonsense: true }],
      providerMetadata: {
        testProvider: {
          images: [{ url: 'https://example.com/image.png' }]
        }
      }
    })

    mockDownloadImageAsBase64.mockResolvedValue({
      data: 'url-base64',
      media_type: 'image/jpeg'
    })

    const fileEntry = { id: 'file-1', origin: 'internal', ext: 'png', name: 'img', size: 3, createdAt: 0 }
    const createInternalEntry = vi.fn().mockResolvedValue(fileEntry)
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'FileManager' ? { createInternalEntry } : undefined
    )

    const result = await service.generateImage({
      uniqueModelId: 'test-provider::test-model',
      prompt: 'draw a cat',
      n: 2,
      size: '1024x1024',
      negativePrompt: 'blurry',
      seed: 7,
      quality: 'high',
      numInferenceSteps: 30,
      guidanceScale: 4.5,
      promptEnhancement: true,
      requestOptions: { signal: new AbortController().signal }
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-model',
        prompt: 'draw a cat',
        n: 2,
        size: '1024x1024',
        negativePrompt: 'blurry',
        seed: 7,
        quality: 'high',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptEnhancement: true
      })
    )

    const callOptions = mockGenerateImage.mock.calls[0]?.[2]
    expect(callOptions.experimental_download).toBeTypeOf('function')

    const downloaded = await callOptions.experimental_download([
      {
        url: new URL('https://example.com/image.png'),
        isUrlSupportedByModel: false
      }
    ])

    expect(mockDownloadImageAsBase64).toHaveBeenCalledWith('https://example.com/image.png')
    expect(downloaded).toEqual([
      {
        data: Buffer.from('url-base64', 'base64'),
        mediaType: 'image/jpeg'
      }
    ])

    expect(createInternalEntry).toHaveBeenCalledWith({ source: 'base64', data: 'data:image/png;base64,abc123' })
    expect(result).toEqual({ files: [fileEntry] })
  })

  it('settles stale agent-session approvals without reading the persistent message table', async () => {
    const service = createService()
    const applyApprovalDecision = vi.fn()
    const respondToolApproval = vi.fn(() => false)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') return { applyApprovalDecision }
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      throw new Error(`Unexpected service lookup: ${name}`)
    })
    mockMessageGetById.mockRejectedValue(new Error("Message with id 'assistant-1' not found"))
    mockListSessionMessages.mockResolvedValue({
      items: [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          status: 'paused',
          data: {
            parts: [
              {
                type: 'tool-Bash',
                toolCallId: 'call-1',
                state: 'approval-requested',
                input: { command: 'pwd' },
                approval: { id: 'approval-1' }
              }
            ]
          },
          modelId: 'provider::model',
          modelSnapshot: null,
          traceId: 'trace-1',
          stats: null,
          runtimeResumeToken: null,
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z'
        }
      ]
    })

    ;(service as any).registerIpcHandlers()
    const handler = getToolApprovalHandler()
    expect(handler).toBeTypeOf('function')

    await expect(
      handler?.(
        { sender: {} },
        {
          approvalId: 'approval-1',
          approved: true,
          topicId: 'agent-session:session-1',
          anchorId: 'assistant-1'
        }
      )
    ).resolves.toEqual({ ok: true, status: 'expired' })

    expect(mockMessageGetById).not.toHaveBeenCalled()
    expect(mockListSessionMessages).toHaveBeenCalledWith('session-1', { messageId: 'assistant-1', limit: 1 })
    expect(mockSaveSessionMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        status: 'paused',
        data: {
          parts: [
            expect.objectContaining({
              state: 'output-denied',
              approval: expect.objectContaining({
                id: 'approval-1',
                approved: false,
                reason: expect.stringContaining('expired')
              })
            })
          ]
        }
      })
    })
  })

  it('treats already-settled stale agent-session approvals as successful', async () => {
    const service = createService()
    const applyApprovalDecision = vi.fn()
    const respondToolApproval = vi.fn(() => false)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') return { applyApprovalDecision }
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      throw new Error(`Unexpected service lookup: ${name}`)
    })
    mockMessageGetById.mockRejectedValue(new Error("Message with id 'assistant-1' not found"))
    mockListSessionMessages.mockResolvedValue({
      items: [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          status: 'paused',
          data: {
            parts: [
              {
                type: 'tool-Bash',
                toolCallId: 'call-1',
                state: 'output-denied',
                input: { command: 'pwd' },
                approval: { id: 'approval-1', approved: false, reason: 'expired' }
              }
            ]
          },
          modelId: 'provider::model',
          modelSnapshot: null,
          traceId: 'trace-1',
          stats: null,
          runtimeResumeToken: null,
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z'
        }
      ]
    })

    ;(service as any).registerIpcHandlers()
    const handler = getToolApprovalHandler()
    expect(handler).toBeTypeOf('function')

    await expect(
      handler?.(
        { sender: {} },
        {
          approvalId: 'approval-1',
          approved: true,
          topicId: 'agent-session:session-1',
          anchorId: 'assistant-1'
        }
      )
    ).resolves.toEqual({ ok: true, status: 'expired' })

    expect(mockMessageGetById).not.toHaveBeenCalled()
    expect(mockSaveSessionMessage).not.toHaveBeenCalled()
  })
})
