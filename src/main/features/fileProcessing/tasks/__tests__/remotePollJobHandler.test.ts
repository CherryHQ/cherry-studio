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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingJobPayload } from '../shared'

const {
  appGetMock,
  fileManagerGetByIdMock,
  fileManagerGetMetadataMock,
  toFileInfoMock,
  resolveProcessorConfigByFeatureMock,
  processorRegistryMock,
  persistResultMock,
  capabilityHandlerMock,
  startRemoteMock,
  pollRemoteMock,
  toPersistableMock,
  rehydrateMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  fileManagerGetByIdMock: vi.fn(),
  fileManagerGetMetadataMock: vi.fn(),
  toFileInfoMock: vi.fn(),
  resolveProcessorConfigByFeatureMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  persistResultMock: vi.fn(),
  capabilityHandlerMock: {
    mode: 'remote-poll' as const,
    prepare: vi.fn()
  },
  startRemoteMock: vi.fn(),
  pollRemoteMock: vi.fn(),
  toPersistableMock: vi.fn(),
  rehydrateMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: appGetMock }
}))

vi.mock('@main/services/file/toFileInfo', () => ({
  toFileInfo: toFileInfoMock
}))

vi.mock('../../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: resolveProcessorConfigByFeatureMock
}))

vi.mock('../../processors/registry', () => ({
  processorRegistry: processorRegistryMock
}))

vi.mock('../../persistence/MarkdownResultStore', () => ({
  markdownResultStore: { persistResultToPath: persistResultMock }
}))

const { remotePollJobHandler } = await import('../remotePollJobHandler')

const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000202'
const FAKE_ENTRY = {
  id: FILE_ENTRY_ID,
  origin: 'external',
  name: 'paper',
  ext: 'pdf',
  externalPath: '/tmp/paper.pdf',
  createdAt: 1,
  updatedAt: 1
}
const FAKE_FILE_INFO = {
  path: '/tmp/paper.pdf',
  name: 'paper',
  ext: 'pdf',
  size: 99_000,
  mime: 'application/pdf',
  type: 'document',
  createdAt: 1,
  modifiedAt: 1
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
    input: {
      feature: 'document_to_markdown',
      file: { kind: 'entry', entryId: FILE_ENTRY_ID },
      output: { kind: 'path', path: '/tmp/out.md' },
      processorId: 'doc2x'
    },
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
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') {
      return {
        getById: fileManagerGetByIdMock,
        getMetadata: fileManagerGetMetadataMock
      }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
  fileManagerGetMetadataMock.mockResolvedValue({
    kind: 'file',
    type: 'other',
    size: 99_000,
    mime: 'application/octet-stream',
    createdAt: 1,
    modifiedAt: 1
  })
  fileManagerGetByIdMock.mockResolvedValue(FAKE_ENTRY)
  toFileInfoMock.mockResolvedValue(FAKE_FILE_INFO)
  capabilityHandlerMock.mode = 'remote-poll'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('remotePollJobHandler.execute', () => {
  it('declares the remote-poll job contract', () => {
    expect(remotePollJobHandler.recovery).toBe('retry')
    expect(
      remotePollJobHandler.defaultQueue?.({
        feature: 'document_to_markdown',
        file: { kind: 'entry', entryId: FILE_ENTRY_ID },
        processorId: 'doc2x'
      })
    ).toBe('file-processing.doc2x')
    expect(remotePollJobHandler.defaultConcurrency).toBe(2)
    expect(remotePollJobHandler.defaultRetryPolicy).toEqual({
      maxAttempts: 1,
      backoff: 'none',
      baseDelayMs: 0,
      maxDelayMs: 0
    })
    expect(remotePollJobHandler.defaultTimeoutMs).toBe(30 * 60_000)
  })

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
    persistResultMock.mockResolvedValue('/tmp/out.md')

    const ctx = createCtx()
    const result = (await remotePollJobHandler.execute(ctx)) as { artifact: unknown }

    expect(result.artifact).toEqual({
      kind: 'file',
      format: 'markdown',
      path: '/tmp/out.md'
    })
    expect(capabilityHandlerMock.prepare).toHaveBeenCalledWith(FAKE_FILE_INFO, expect.any(Object), ctx.signal, {})
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
    persistResultMock.mockResolvedValue('/tmp/out.md')

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
    persistResultMock.mockResolvedValue('/tmp/out.md')

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
    persistResultMock.mockResolvedValue('/tmp/out.md')

    const ctx = createCtx()
    const exec = remotePollJobHandler.execute(ctx)
    await vi.advanceTimersByTimeAsync(1_500)
    await exec

    const patchPayloads = (ctx.patchMetadata as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(patchPayloads).toHaveLength(2)
    expect(patchPayloads[0]).toEqual({ remoteState: { providerTaskId: 't', stage: 'parsing', apiHost: 'https://h' } })
    expect(patchPayloads[1]).toEqual({ remoteState: { providerTaskId: 't', stage: 'exporting', apiHost: 'https://h' } })
  })

  it('throws when pollRemote returns failed status before artifacts are persisted', async () => {
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
  })

  it('propagates AbortError when startRemote() rejects with it', async () => {
    setupCapability()
    startRemoteMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))

    await expect(remotePollJobHandler.execute(createCtx())).rejects.toThrow(/abort/i)
  })

  it('propagates artifact persistence failures on completed poll', async () => {
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
