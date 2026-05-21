/**
 * Unit tests for remotePollJobHandler.
 *
 * Covers: first-launch path (startRemote → patchMetadata → pollRemote → done),
 * cross-restart resume (metadata.remoteState present → rehydrate → skip
 * startRemote), stage-switch persistence (patchMetadata called again with new
 * stage), abort during sleep, and the critical A1 invariant — apiKey is never
 * written to jobTable.metadata.
 */
import type { JobContext } from '@main/core/job/types'
import type { FileMetadata } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingJobPayload } from '../shared'

const {
  resolveProcessorConfigByFeatureMock,
  processorRegistryMock,
  persistResultMock,
  cleanupResultsDirMock,
  capabilityHandlerMock,
  startRemoteMock,
  pollRemoteMock,
  toPersistableMock,
  rehydrateMock
} = vi.hoisted(() => ({
  resolveProcessorConfigByFeatureMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  persistResultMock: vi.fn(),
  cleanupResultsDirMock: vi.fn(),
  capabilityHandlerMock: {
    mode: 'remote-poll' as const,
    prepare: vi.fn()
  },
  startRemoteMock: vi.fn(),
  pollRemoteMock: vi.fn(),
  toPersistableMock: vi.fn(),
  rehydrateMock: vi.fn()
}))

vi.mock('../../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: resolveProcessorConfigByFeatureMock
}))

vi.mock('../../processors/registry', () => ({
  processorRegistry: processorRegistryMock
}))

vi.mock('../../persistence/MarkdownResultStore', () => ({
  markdownResultStore: { persistResult: persistResultMock },
  cleanupFileProcessingResultsDir: cleanupResultsDirMock
}))

const { remotePollJobHandler } = await import('../remotePollJobHandler')

const FAKE_PDF: FileMetadata = {
  id: 'file-2',
  name: 'paper.pdf',
  origin_name: 'paper.pdf',
  path: '/tmp/paper.pdf',
  size: 99_000,
  ext: '.pdf',
  type: 'document',
  created_at: '2026-05-01T00:00:00.000Z',
  count: 1
}

function setupCapability() {
  const prepared = {
    mode: 'remote-poll' as const,
    startRemote: startRemoteMock,
    pollRemote: pollRemoteMock,
    toPersistable: toPersistableMock,
    rehydrate: rehydrateMock
  }
  capabilityHandlerMock.prepare.mockResolvedValue(prepared)
  processorRegistryMock.doc2x = {
    capabilities: { document_to_markdown: capabilityHandlerMock },
    isAvailable: () => true
  }
  resolveProcessorConfigByFeatureMock.mockReturnValue({
    id: 'doc2x',
    capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
  })
}

function createCtx(
  overrides: Partial<JobContext<FileProcessingJobPayload>> = {}
): JobContext<FileProcessingJobPayload> {
  const controller = new AbortController()
  return {
    jobId: 'job-2',
    input: { feature: 'document_to_markdown', file: FAKE_PDF, processorId: 'doc2x' },
    attempt: 0,
    signal: controller.signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...overrides
  } as JobContext<FileProcessingJobPayload>
}

beforeEach(() => {
  vi.clearAllMocks()
  capabilityHandlerMock.mode = 'remote-poll'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('remotePollJobHandler.execute', () => {
  it('first launch: startRemote → patchMetadata(whitelist) → pollRemote → artifacts', async () => {
    setupCapability()
    const remoteCtx = { apiHost: 'https://doc2x.example.com', apiKey: 'SECRET_KEY', stage: 'parsing' }
    startRemoteMock.mockResolvedValue({
      providerTaskId: 'provider-task-xyz',
      status: 'processing',
      progress: 0,
      remoteContext: remoteCtx
    })
    toPersistableMock.mockReturnValue({
      providerTaskId: 'provider-task-xyz',
      stage: 'parsing',
      apiHost: remoteCtx.apiHost
    })
    pollRemoteMock.mockResolvedValue({
      status: 'completed',
      output: { kind: 'remote-zip-url', downloadUrl: 'https://example.com/x.zip', configuredApiHost: remoteCtx.apiHost }
    })
    persistResultMock.mockResolvedValue('/tmp/results/job-2/output.md')

    const ctx = createCtx()
    const result = (await remotePollJobHandler.execute(ctx)) as { artifacts: unknown[] }

    expect(result.artifacts).toEqual([{ kind: 'file', format: 'markdown', path: '/tmp/results/job-2/output.md' }])
    expect(toPersistableMock).toHaveBeenCalledWith(remoteCtx, 'provider-task-xyz')

    const patchCalls = (ctx.patchMetadata as ReturnType<typeof vi.fn>).mock.calls
    expect(patchCalls).toHaveLength(1)
    const persistedPayload = patchCalls[0][0] as { remoteState: Record<string, unknown> }
    expect(persistedPayload.remoteState).toMatchObject({
      providerTaskId: 'provider-task-xyz',
      stage: 'parsing',
      apiHost: remoteCtx.apiHost
    })
  })

  it('A1: apiKey never appears in patchMetadata payload (whitelist invariant)', async () => {
    setupCapability()
    const remoteCtx = { apiHost: 'https://doc2x.example.com', apiKey: 'SUPER_SECRET', stage: 'parsing' }
    startRemoteMock.mockResolvedValue({
      providerTaskId: 'task-1',
      status: 'processing',
      progress: 0,
      remoteContext: remoteCtx
    })
    toPersistableMock.mockReturnValue({ providerTaskId: 'task-1', stage: 'parsing', apiHost: remoteCtx.apiHost })
    pollRemoteMock.mockResolvedValue({
      status: 'completed',
      output: { kind: 'remote-zip-url', downloadUrl: 'https://x.zip', configuredApiHost: remoteCtx.apiHost }
    })
    persistResultMock.mockResolvedValue('/tmp/results/job-2/output.md')

    const ctx = createCtx()
    await remotePollJobHandler.execute(ctx)

    const allPatchPayloads = (ctx.patchMetadata as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    const serialized = JSON.stringify(allPatchPayloads)
    expect(serialized).not.toContain('SUPER_SECRET')
    expect(serialized).not.toContain('apiKey')
  })

  it('resume from metadata: skips startRemote and calls rehydrate', async () => {
    setupCapability()
    const restoredCtx = { apiHost: 'https://doc2x.example.com', apiKey: 're-read-key', stage: 'exporting' }
    rehydrateMock.mockReturnValue({ providerTaskId: 'recovered-task', remoteContext: restoredCtx })
    pollRemoteMock.mockResolvedValue({
      status: 'completed',
      output: { kind: 'remote-zip-url', downloadUrl: 'https://x.zip', configuredApiHost: restoredCtx.apiHost }
    })
    persistResultMock.mockResolvedValue('/tmp/results/job-2/output.md')

    const ctx = createCtx({
      metadata: { remoteState: { providerTaskId: 'recovered-task', stage: 'exporting', apiHost: restoredCtx.apiHost } }
    })

    await remotePollJobHandler.execute(ctx)

    expect(startRemoteMock).not.toHaveBeenCalled()
    expect(rehydrateMock).toHaveBeenCalledWith(
      { providerTaskId: 'recovered-task', stage: 'exporting', apiHost: restoredCtx.apiHost },
      expect.objectContaining({ id: 'doc2x' })
    )
    expect(pollRemoteMock).toHaveBeenCalledWith(
      { providerTaskId: 'recovered-task', remoteContext: restoredCtx },
      ctx.signal
    )
  })

  it('persists updated PersistableRemoteState when stage switches (parsing → exporting)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setupCapability()
    const parsingCtx = { apiHost: 'https://h', apiKey: 'k', stage: 'parsing' }
    const exportingCtx = { apiHost: 'https://h', apiKey: 'k', stage: 'exporting' }
    startRemoteMock.mockResolvedValue({
      providerTaskId: 't',
      status: 'processing',
      progress: 0,
      remoteContext: parsingCtx
    })
    toPersistableMock
      .mockReturnValueOnce({ providerTaskId: 't', stage: 'parsing', apiHost: 'https://h' })
      .mockReturnValueOnce({ providerTaskId: 't', stage: 'exporting', apiHost: 'https://h' })
    pollRemoteMock
      .mockResolvedValueOnce({ status: 'processing', progress: 50, remoteContext: exportingCtx })
      .mockResolvedValueOnce({
        status: 'completed',
        output: { kind: 'remote-zip-url', downloadUrl: 'https://x.zip', configuredApiHost: 'https://h' }
      })
    persistResultMock.mockResolvedValue('/tmp/results/job-2/output.md')

    const ctx = createCtx()
    const exec = remotePollJobHandler.execute(ctx)
    await vi.advanceTimersByTimeAsync(1_500)
    await exec

    const patchPayloads = (ctx.patchMetadata as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(patchPayloads).toHaveLength(2)
    expect(patchPayloads[0]).toEqual({ remoteState: { providerTaskId: 't', stage: 'parsing', apiHost: 'https://h' } })
    expect(patchPayloads[1]).toEqual({ remoteState: { providerTaskId: 't', stage: 'exporting', apiHost: 'https://h' } })
  })

  it('throws and cleans up when pollRemote returns failed status (after artifacts persisted)', async () => {
    setupCapability()
    startRemoteMock.mockResolvedValue({
      providerTaskId: 't',
      status: 'processing',
      progress: 0,
      remoteContext: { apiHost: 'https://h', apiKey: 'k' }
    })
    toPersistableMock.mockReturnValue({ providerTaskId: 't', apiHost: 'https://h' })
    pollRemoteMock.mockResolvedValue({ status: 'failed', error: 'remote rejected' })

    await expect(remotePollJobHandler.execute(createCtx())).rejects.toThrow('remote rejected')
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
  })

  it('propagates AbortError when startRemote() rejects with it (no artifacts yet → no cleanup)', async () => {
    setupCapability()
    startRemoteMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))

    await expect(remotePollJobHandler.execute(createCtx())).rejects.toThrow(/abort/i)
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
  })

  it('cleans up partial artifacts when persistResult() throws on completed poll', async () => {
    setupCapability()
    startRemoteMock.mockResolvedValue({
      providerTaskId: 't',
      status: 'processing',
      progress: 0,
      remoteContext: { apiHost: 'https://h', apiKey: 'k' }
    })
    toPersistableMock.mockReturnValue({ providerTaskId: 't', apiHost: 'https://h' })
    pollRemoteMock.mockResolvedValue({
      status: 'completed',
      output: { kind: 'remote-zip-url', downloadUrl: 'https://x.zip', configuredApiHost: 'https://h' }
    })
    persistResultMock.mockRejectedValue(new Error('disk full'))

    await expect(remotePollJobHandler.execute(createCtx())).rejects.toThrow('disk full')
    expect(cleanupResultsDirMock).toHaveBeenCalledWith('job-2')
  })

  it('rejects when prepared.mode does not match handler.mode (drift guard)', async () => {
    capabilityHandlerMock.mode = 'remote-poll'
    capabilityHandlerMock.prepare.mockResolvedValue({
      mode: 'background',
      execute: vi.fn()
    })
    processorRegistryMock.doc2x = {
      capabilities: { document_to_markdown: capabilityHandlerMock },
      isAvailable: () => true
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })

    await expect(remotePollJobHandler.execute(createCtx())).rejects.toThrow(/mode mismatch/i)
  })
})
