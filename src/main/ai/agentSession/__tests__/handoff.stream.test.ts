import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readConversation: vi.fn(),
  getModelByKey: vi.fn(),
  getProviderByProviderId: vi.fn(),
  streamPrompt: vi.fn(),
  abort: vi.fn(),
  resolveDialect: vi.fn(),
  getTokenizer: vi.fn(),
  estimate: vi.fn(),
  resolveReservation: vi.fn()
}))

vi.mock('../../messages/readConversation', () => ({ readConversation: mocks.readConversation }))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.getModelByKey } }))
vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: mocks.getProviderByProviderId }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AiStreamManager: { streamPrompt: mocks.streamPrompt, abort: mocks.abort } } as never)
})
vi.mock('../../tokens/dialect', () => ({ resolveModelTokenDialect: mocks.resolveDialect }))
vi.mock('../../tokens/profiles', () => ({ getTextTokenizer: mocks.getTokenizer }))
vi.mock('../../tokens/footprint', () => ({ estimateModelMessagesFootprint: mocks.estimate }))
vi.mock('../../contextBuild/resolveOutputReservation', () => ({ resolveOutputReservation: mocks.resolveReservation }))

const { prepareHandoffDraft, streamHandoffDraft } = await import('../handoff')

const sourcePage = {
  source: 'topic' as const,
  sessionId: 'source-1',
  activeNodeId: null,
  assistantId: null,
  rootId: null,
  messages: [],
  nextCursor: undefined
}

class PrototypeListener {
  readonly id = 'prototype-listener'
  readonly chunks: unknown[] = []
  done = 0
  onChunk(chunk: unknown): void {
    this.chunks.push(chunk)
  }
  onDone(): void {
    this.done += 1
  }
  onPaused(): void {}
  onError(): void {}
  isAlive(): boolean {
    return true
  }
}

describe('handoff draft stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    mocks.readConversation.mockReturnValue(sourcePage)
    mocks.getModelByKey.mockReturnValue({ id: 'provider::model', providerId: 'provider', contextWindow: 100_000 })
    mocks.getProviderByProviderId.mockReturnValue({ authMethods: ['api-key'] })
    mocks.resolveDialect.mockReturnValue('openai')
    mocks.getTokenizer.mockResolvedValue({ id: 'test', count: () => 1 })
    mocks.estimate.mockResolvedValue(10)
    mocks.resolveReservation.mockReturnValue(undefined)
    mocks.streamPrompt.mockReturnValue({ mode: 'started', activeExecutions: [] })
  })

  it('rejects unknown model capacity and does not start a model stream', async () => {
    mocks.getModelByKey.mockReturnValue({ id: 'provider::model', providerId: 'provider' })
    await expect(
      prepareHandoffDraft({
        sourceSessionId: 'source-1',
        task: 'continue',
        target: { agentId: 'agent-1', name: 'Builder' },
        summaryModelId: 'provider::model'
      })
    ).rejects.toMatchObject({ code: 'MODEL_CAPACITY_UNKNOWN' })
    expect(mocks.streamPrompt).not.toHaveBeenCalled()
  })

  it('rejects an oversized task before reading source material or resolving a model', async () => {
    await expect(
      prepareHandoffDraft({
        sourceSessionId: 'source-1',
        task: 'x'.repeat(40_001),
        target: { agentId: 'agent-1', name: 'Builder' },
        summaryModelId: 'provider::model'
      })
    ).rejects.toMatchObject({ code: 'PROMPT_TOO_LARGE' })
    expect(mocks.readConversation).not.toHaveBeenCalled()
    expect(mocks.getModelByKey).not.toHaveBeenCalled()
  })

  it('does not start after cancellation while async preparation is pending', async () => {
    let releaseTokenizer!: (value: { id: string; count: () => number }) => void
    mocks.getTokenizer.mockReturnValue(new Promise((resolve) => (releaseTokenizer = resolve)))
    const handle = streamHandoffDraft({
      sourceSessionId: 'source-1',
      task: 'continue',
      target: { agentId: 'agent-1', name: 'Builder' },
      summaryModelId: 'provider::model',
      listener: new PrototypeListener()
    })
    handle.cancel()
    releaseTokenizer({ id: 'test', count: () => 1 })
    await expect(handle.ready).resolves.toMatchObject({ cancelled: true })
    expect(mocks.streamPrompt).not.toHaveBeenCalled()
  })

  it('delegates prototype listener methods and aborts the active stream', async () => {
    const listener = new PrototypeListener()
    const handle = streamHandoffDraft({
      sourceSessionId: 'source-1',
      task: 'continue',
      target: { agentId: 'agent-1', name: 'Builder' },
      summaryModelId: 'provider::model',
      listener,
      streamId: 'handoff:draft:00000000-0000-4000-8000-000000000001'
    })
    await expect(handle.ready).resolves.toMatchObject({ sendResult: { mode: 'started' }, cancelled: false })
    const wrapped = mocks.streamPrompt.mock.calls[0][0].listener[0]
    wrapped.onChunk({ type: 'text-delta', id: 'x', delta: 'ok' })
    expect(listener.chunks).toHaveLength(1)
    handle.cancel('user-cancelled')
    expect(mocks.abort).toHaveBeenCalledWith('handoff:draft:00000000-0000-4000-8000-000000000001', 'user-cancelled')
  })

  it('does not start when the renderer window dies during preparation', async () => {
    const listener = new PrototypeListener()
    listener.isAlive = () => false
    const handle = streamHandoffDraft({
      sourceSessionId: 'source-1',
      task: 'continue',
      target: { agentId: 'agent-1', name: 'Builder' },
      summaryModelId: 'provider::model',
      listener
    })

    await expect(handle.ready).resolves.toMatchObject({ cancelled: true })
    expect(mocks.streamPrompt).not.toHaveBeenCalled()
  })
})
