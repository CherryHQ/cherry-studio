import { BaseService } from '@main/core/lifecycle/BaseService'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateImage = vi.fn()
const mockRerank = vi.fn()
const mockDownloadImageAsBase64 = vi.fn()
const mockApplicationGet = vi.fn()
const mockMessageGetById = vi.fn()
const mockMessageUpdate = vi.fn()
const mockMessageApplyApproval = vi.fn()
const mockProviderGetByProviderId = vi.fn()
const mockProviderGetRotatedApiKey = vi.fn()
const mockModelGetByKey = vi.fn()

vi.mock('@main/core/application', () => ({
  application: {
    get: mockApplicationGet
  }
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: (...args: unknown[]) => mockProviderGetByProviderId(...args),
    getRotatedApiKey: (...args: unknown[]) => mockProviderGetRotatedApiKey(...args)
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: (...args: unknown[]) => mockModelGetByKey(...args)
  }
}))

vi.mock('@main/utils/downloadAsBase64', () => ({
  downloadImageAsBase64: (...args: unknown[]) => mockDownloadImageAsBase64(...args)
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    getById: mockMessageGetById,
    update: mockMessageUpdate,
    applyToolApprovalDecisions: mockMessageApplyApproval
  }
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: vi.fn(),
  embedMany: vi.fn(),
  generateImage: (...args: unknown[]) => mockGenerateImage(...args),
  rerank: (...args: unknown[]) => mockRerank(...args)
}))

const { AiService, imageInputEntryParams } = await import('../AiService')
const { messageService } = await import('@main/data/services/MessageService')

/**
 * Instantiate `AiService` directly (without going through the lifecycle
 * container) so unit tests can drive its methods in isolation.
 */
function createService(): InstanceType<typeof AiService> {
  BaseService.resetInstances()
  return new (AiService as any)()
}

describe('AiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderGetRotatedApiKey.mockResolvedValue('test-key')
    mockProviderGetByProviderId.mockResolvedValue({
      id: 'test-provider',
      name: 'Test Provider',
      apiKeys: [],
      authType: 'api-key',
      apiFeatures: {
        arrayContent: true,
        streamOptions: true,
        developerRole: false,
        serviceTier: false,
        verbosity: false
      },
      settings: {},
      isEnabled: true
    })
    mockModelGetByKey.mockResolvedValue({
      id: 'test-provider::test-model',
      providerId: 'test-provider',
      apiModelId: 'test-model',
      name: 'Test Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
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

  it("omits SDK size when size is the 'auto' sentinel", async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-model'
      }
    } as never)

    mockGenerateImage.mockResolvedValue({ images: [] })
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'FileManager' ? { createInternalEntry: vi.fn() } : undefined
    )

    await service.generateImage({
      uniqueModelId: 'test-provider::test-model',
      prompt: 'draw a cat',
      size: 'auto'
    })

    const callOptions = mockGenerateImage.mock.calls[0]?.[2] as Record<string, unknown>
    expect(callOptions).not.toHaveProperty('size')
  })
})

describe('AiService tool approval', () => {
  /** A fake renderer event whose `sender` satisfies `WebContentsListener`'s constructor. */
  function fakeEvent() {
    return {
      sender: {
        id: 1,
        once: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn()
      }
    } as never
  }

  /** A minimal `approval-requested` tool UI part (passes `isToolUIPart`). */
  function pendingToolPart(approvalId: string, toolName = 'mcp_write') {
    return {
      type: `tool-${toolName}`,
      toolCallId: `tc-${approvalId}`,
      state: 'approval-requested',
      input: {},
      approval: { id: approvalId }
    }
  }

  function approvalMutationResult(
    parts: unknown[],
    appliedApprovalIds: string[] = [],
    alreadySettledApprovalIds: string[] = []
  ) {
    return { parts, appliedApprovalIds, alreadySettledApprovalIds }
  }

  /**
   * Instantiate `AiService`, register its IPC handlers against the mocked
   * `ipcMain`, and return the captured `Ai_ToolApproval_Respond` listener.
   */
  function getApprovalHandler() {
    const service = createService()
    ;(service as unknown as { registerIpcHandlers(): void }).registerIpcHandlers()
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === IpcChannel.Ai_ToolApproval_Respond)
    if (!call) throw new Error('Ai_ToolApproval_Respond handler was not registered')
    return call[1] as (
      event: unknown,
      payload: {
        approvalId: string
        approved: boolean
        reason?: string
        updatedInput?: Record<string, unknown>
        topicId?: string
        anchorId?: string
      }
    ) => Promise<{ ok: boolean }>
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('takes the Claude-Agent fast-path when the live registry dispatches the decision', async () => {
    const respondToolApproval = vi.fn(() => true)
    const dispatch = vi.fn()
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })
    const getById = vi.spyOn(messageService, 'getById')

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'agent-approval-1',
      approved: true
    })

    expect(result).toEqual({ ok: true })
    expect(respondToolApproval).toHaveBeenCalledWith('agent-approval-1', {
      approved: true,
      reason: undefined,
      updatedInput: undefined
    })
    // Fast-path short-circuits before any DB read or continue dispatch.
    expect(getById).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when there is no live entry and no anchor context', async () => {
    const respondToolApproval = vi.fn(() => false)
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'AgentSessionRuntimeService' ? { respondToolApproval } : undefined
    )
    const getById = vi.spyOn(messageService, 'getById')

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'orphan-approval-1',
      approved: true
      // no topicId / anchorId
    })

    expect(result).toEqual({ ok: false })
    expect(getById).not.toHaveBeenCalled()
  })

  it('applies the decision atomically and dispatches continue-conversation when nothing is left pending', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // The serialized atomic mutation returns the committed parts with the decision applied; the
    // handler computes "still pending" from THESE committed parts, not a local stale copy.
    const committed = [
      { type: 'text', text: 'hello' },
      { ...pendingToolPart('mcp-approval-1'), state: 'approval-responded', input: { command: 'pwd' } }
    ]
    const apply = vi
      .spyOn(messageService, 'applyToolApprovalDecisions')
      .mockResolvedValue(approvalMutationResult(committed, ['mcp-approval-1']) as never)

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      updatedInput: { command: 'pwd' },
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    // The decision goes through the serialized read-modify-write, not an ad-hoc getById+update.
    expect(apply).toHaveBeenCalledWith('anchor-1', [
      { approvalId: 'mcp-approval-1', approved: true, updatedInput: { command: 'pwd' } }
    ])
    // Nothing left pending → resume via continue-conversation.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: 'continue-conversation',
        topicId: 'topic-1',
        parentAnchorId: 'anchor-1',
        approvalDecisions: [{ approvalId: 'mcp-approval-1', approved: true, updatedInput: { command: 'pwd' } }]
      })
    )
  })

  it('refuses (ok:false) without mutating the row when a stream is still live on the topic', async () => {
    // The approval card is clickable the moment the chunk arrives (live overlay), so a response can
    // land while a sibling exec / another continuation is still live. Dispatching continue-conversation
    // then would hit send()'s inject path and silently swallow the approved turn. Gate it: refuse
    // before touching the row, so the card stays actionable and the renderer can retry post-settle.
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    const hasLiveStream = vi.fn(() => true)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream }
      return undefined
    })
    const apply = vi.spyOn(messageService, 'applyToolApprovalDecisions')

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: false })
    expect(hasLiveStream).toHaveBeenCalledWith('topic-1')
    // Row is NOT mutated and no continuation is dispatched.
    expect(apply).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('still dispatches when the committed parts report nothing pending (overlay-only decision)', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // Overlay-only: the target part isn't on the row, so the committed parts carry no pending approval.
    const apply = vi
      .spyOn(messageService, 'applyToolApprovalDecisions')
      .mockResolvedValue(approvalMutationResult([{ type: 'text', text: 'hello' }]) as never)

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-missing',
      approved: false,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    expect(apply).toHaveBeenCalledWith('anchor-1', [{ approvalId: 'mcp-approval-missing', approved: false }])
    // The decision still rides the continue dispatch idempotently.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: 'continue-conversation',
        approvalDecisions: [{ approvalId: 'mcp-approval-missing', approved: false }]
      })
    )
  })

  it('does not finalize while another approval on the turn is still pending', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // Committed parts: this approval decided, but a sibling is still approval-requested.
    vi.spyOn(messageService, 'applyToolApprovalDecisions').mockResolvedValue(
      approvalMutationResult(
        [
          { ...pendingToolPart('mcp-approval-1'), state: 'approval-responded' },
          pendingToolPart('mcp-approval-2', 'mcp_read')
        ],
        ['mcp-approval-1']
      ) as never
    )

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    // The still-pending sibling gates the resume.
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('ignores duplicate already-settled approval responses without dispatching another continuation', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    const apply = vi
      .spyOn(messageService, 'applyToolApprovalDecisions')
      .mockResolvedValue(
        approvalMutationResult(
          [{ ...pendingToolPart('mcp-approval-1'), state: 'approval-responded' }],
          [],
          ['mcp-approval-1']
        ) as never
      )

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    expect(apply).toHaveBeenCalledWith('anchor-1', [{ approvalId: 'mcp-approval-1', approved: true }])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when the anchor message is missing or deleted', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // A stale click on a deleted message: the atomic mutation reports the anchor is gone (null).
    const apply = vi.spyOn(messageService, 'applyToolApprovalDecisions').mockResolvedValue(null)

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'deleted-anchor'
    })

    // Resolves gracefully through the documented result shape instead of throwing.
    expect(result).toEqual({ ok: false })
    expect(apply).toHaveBeenCalledWith('deleted-anchor', [{ approvalId: 'mcp-approval-1', approved: true }])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when the IPC payload is invalid (rejected at the boundary)', async () => {
    const respondToolApproval = vi.fn(() => true)
    const dispatch = vi.fn()
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })
    const getById = vi.spyOn(messageService, 'getById')

    const handler = getApprovalHandler()
    // Missing `approved` boolean and empty `approvalId` → schema rejects.
    const result = await handler(fakeEvent(), { approvalId: '' } as never)

    expect(result).toEqual({ ok: false })
    // Rejected before any registry dispatch or DB read.
    expect(respondToolApproval).not.toHaveBeenCalled()
    expect(getById).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('routes rerank requests through ai-core rerank', async () => {
    const service = createService()
    const abortController = new AbortController()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-reranker'
      },
      options: {
        headers: { 'x-test': 'yes' },
        maxRetries: 0
      }
    } as never)

    mockRerank.mockResolvedValue({
      ranking: [
        { originalIndex: 1, score: 0.9, document: 'beta' },
        { originalIndex: 0, score: 0.2, document: 'alpha' }
      ]
    })

    await expect(
      service.rerank({
        uniqueModelId: 'test-provider::test-reranker',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 2,
        requestOptions: {
          headers: { 'x-test': 'yes' },
          maxRetries: 0,
          signal: abortController.signal
        }
      })
    ).resolves.toEqual({
      ranking: [
        { originalIndex: 1, score: 0.9 },
        { originalIndex: 0, score: 0.2 }
      ]
    })

    expect(mockRerank).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-reranker',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 2,
        headers: { 'x-test': 'yes' },
        maxRetries: 0,
        abortSignal: abortController.signal
      })
    )
  })

  it('checks rerank models with rerank before embedding or text generation', async () => {
    const service = createService()
    const rerankSpy = vi.spyOn(service, 'rerank').mockResolvedValue({ ranking: [{ originalIndex: 0, score: 1 }] })
    const embedSpy = vi.spyOn(service, 'embedMany')
    const generateSpy = vi.spyOn(service, 'generateText')

    mockModelGetByKey.mockResolvedValue({
      id: 'test-provider::test-reranker',
      providerId: 'test-provider',
      apiModelId: 'test-reranker',
      name: 'Test Reranker',
      capabilities: [MODEL_CAPABILITY.RERANK, MODEL_CAPABILITY.EMBEDDING],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({
      uniqueModelId: 'test-provider::test-reranker'
    })

    expect(rerankSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'test',
        documents: ['test'],
        topN: 1
      })
    )
    expect(embedSpy).not.toHaveBeenCalled()
    expect(generateSpy).not.toHaveBeenCalled()
  })

  it('fails rerank health checks when the probe returns an empty ranking', async () => {
    const service = createService()
    vi.spyOn(service, 'rerank').mockResolvedValue({ ranking: [] })

    mockModelGetByKey.mockResolvedValue({
      id: 'test-provider::test-reranker',
      providerId: 'test-provider',
      apiModelId: 'test-reranker',
      name: 'Test Reranker',
      capabilities: [MODEL_CAPABILITY.RERANK],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })

    await expect(
      service.checkModel({
        uniqueModelId: 'test-provider::test-reranker'
      })
    ).rejects.toThrow('Rerank health check returned empty ranking')
  })
})

describe('imageInputEntryParams', () => {
  it('maps a base64 data URL to a base64 entry', () => {
    expect(imageInputEntryParams('data:image/png;base64,AAAA')).toEqual({
      source: 'base64',
      data: 'data:image/png;base64,AAAA'
    })
  })

  it('maps an http(s) URL to a url entry (preserves the inputImages URL contract)', () => {
    expect(imageInputEntryParams('https://cdn.example.com/in.png')).toEqual({
      source: 'url',
      url: 'https://cdn.example.com/in.png'
    })
  })
})

describe('AiService.generateImage — custom async transport (job path)', () => {
  // Force the job branch by resolving to a custom-transport provider id; real
  // resolveImageTransport('ppio', …) returns a transport, so generateImage routes
  // through generateImageViaJob.
  function stubResolution(service: InstanceType<typeof AiService>) {
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'ppio', providerSettings: {}, modelId: 'qwen-image' }
    } as never)
  }

  it('enqueues the job, returns its output files, and cleans up the temp input copies', async () => {
    const service = createService()
    stubResolution(service)

    const createInternalEntry = vi.fn().mockResolvedValue({ id: 'in-1' })
    const permanentDelete = vi.fn().mockResolvedValue(undefined)
    const outputFiles = [{ id: 'out-1', origin: 'internal', ext: 'png', name: 'img', size: 3, createdAt: 0 }]
    const enqueue = vi.fn().mockResolvedValue({
      id: 'job-1',
      snapshot: {},
      finished: Promise.resolve({ status: 'completed', output: { files: outputFiles }, error: null })
    })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager') return { createInternalEntry, permanentDelete }
      if (name === 'JobManager') return { enqueue, cancel: vi.fn() }
      return undefined
    })

    const result = await service.generateImage({
      uniqueModelId: 'ppio::qwen-image',
      prompt: 'a cat',
      inputImages: ['data:image/png;base64,AAAA'],
      requestOptions: { signal: new AbortController().signal }
    })

    expect(enqueue).toHaveBeenCalledWith(
      'image-generation.generate',
      expect.objectContaining({ uniqueModelId: 'ppio::qwen-image', prompt: 'a cat', inputFileIds: ['in-1'] })
    )
    expect(result).toEqual({ files: outputFiles })
    expect(permanentDelete).toHaveBeenCalledWith('in-1')
  })

  it('maps a failed job snapshot to a thrown error', async () => {
    const service = createService()
    stubResolution(service)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager')
        return { createInternalEntry: vi.fn(), permanentDelete: vi.fn().mockResolvedValue(undefined) }
      if (name === 'JobManager') {
        return {
          enqueue: vi.fn().mockResolvedValue({
            id: 'job-1',
            snapshot: {},
            finished: Promise.resolve({ status: 'failed', output: null, error: { message: 'vendor exploded' } })
          }),
          cancel: vi.fn()
        }
      }
      return undefined
    })

    await expect(service.generateImage({ uniqueModelId: 'ppio::qwen-image', prompt: 'a cat' })).rejects.toThrow(
      'vendor exploded'
    )
  })

  it('cancels the job and throws AbortError when the request is aborted', async () => {
    const service = createService()
    stubResolution(service)
    const controller = new AbortController()
    controller.abort()
    const cancel = vi.fn().mockResolvedValue({ outcome: 'cancelled' })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager')
        return { createInternalEntry: vi.fn(), permanentDelete: vi.fn().mockResolvedValue(undefined) }
      if (name === 'JobManager') {
        return {
          enqueue: vi.fn().mockResolvedValue({
            id: 'job-1',
            snapshot: {},
            finished: Promise.resolve({ status: 'cancelled', output: null, error: null })
          }),
          cancel
        }
      }
      return undefined
    })

    await expect(
      service.generateImage({
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'a cat',
        requestOptions: { signal: controller.signal }
      })
    ).rejects.toThrow(/abort/i)
    expect(cancel).toHaveBeenCalledWith('job-1', expect.any(String))
  })

  it('cleans up already-created temp input entries when setup fails before enqueue', async () => {
    const service = createService()
    stubResolution(service)
    const permanentDelete = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager') {
        return { createInternalEntry: vi.fn().mockResolvedValue({ id: 'in-1' }), permanentDelete }
      }
      // enqueue fails after the temp input entry was already created → the entry is in
      // no payload, so generateImageViaJob's setup catch must delete it.
      if (name === 'JobManager')
        return { enqueue: vi.fn().mockRejectedValue(new Error('enqueue boom')), cancel: vi.fn() }
      return undefined
    })

    await expect(
      service.generateImage({
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'edit',
        inputImages: ['data:image/png;base64,AAAA']
      })
    ).rejects.toThrow('enqueue boom')
    expect(permanentDelete).toHaveBeenCalledWith('in-1')
  })
})
