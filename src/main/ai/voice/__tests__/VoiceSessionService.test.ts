import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { fileEntryService } from '@data/services/FileEntryService'
import { BaseService } from '@main/core/lifecycle'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID } from '@shared/ai/localVoice'

import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { VoiceSessionService, type VoiceOwner } from '../VoiceSessionService'

const native = vi.hoisted(() => ({ status: vi.fn(), transcribe: vi.fn(), speech: vi.fn() }))
vi.mock('../localAdapters', () => ({
  getLocalVoiceStatus: native.status,
  listLocalVoices: vi.fn(),
  installAppleAsrAsset: vi.fn(),
  voiceAudioProcess: { id: 'voice.audio' }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))
vi.mock('@data/db/restore/restoreJournal', () => ({ hasPendingRestore: () => false }))
const { FileManager } = await import('@main/services/file/FileManager')

function owner(): VoiceOwner {
  const events = new EventEmitter()
  return {
    windowId: randomUUID(),
    webContents: Object.assign(events, {
      id: Math.random(),
      isDestroyed: () => false
    }) as unknown as VoiceOwner['webContents']
  }
}
function ownerDestroyedWhileReattaching(): VoiceOwner {
  const events = new EventEmitter()
  let destroyed = false
  let destroyedRegistrations = 0
  const originalOnce = events.once.bind(events)
  events.once = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === 'destroyed' && ++destroyedRegistrations === 2) {
      destroyed = true
      events.emit('destroyed')
    }
    return originalOnce(event, listener)
  }) as typeof events.once
  return {
    windowId: randomUUID(),
    webContents: Object.assign(events, {
      id: Math.random(),
      isDestroyed: () => destroyed
    }) as unknown as VoiceOwner['webContents']
  }
}
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])
function wav() {
  const data = Buffer.alloc(46)
  data.write('RIFF')
  data.writeUInt32LE(38, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(16000, 24)
  data.writeUInt32LE(32000, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(2, 40)
  return data
}

describe('VoiceSessionService file and admission contract', () => {
  const db = setupTestDatabase()
  let root: string
  let service: VoiceSessionService
  let files: InstanceType<typeof FileManager>
  let a: VoiceOwner
  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainDbServiceUtils.setDb(db.db)
    root = await mkdtemp(path.join(tmpdir(), 'voice-session-'))
    files = new FileManager()
    vi.mocked(application.get).mockImplementation(((name: string) => {
      if (name === 'FileManager') return files
      if (name === 'AiService') return { transcribe: native.transcribe, generateSpeech: native.speech }
      if (name === 'UtilityProcessManager') return { register: vi.fn() }
      return defaultServiceInstances[name as keyof typeof defaultServiceInstances]
    }) as typeof application.get)
    vi.mocked(application.getPath).mockImplementation((_key, filename) => (filename ? path.join(root, filename) : root))
    native.status.mockReset().mockResolvedValue({ status: 'ready' })
    native.transcribe.mockReset().mockResolvedValue({ text: 'private-transcript', segments: [] })
    native.speech.mockReset().mockResolvedValue({ audio: wav(), mediaType: 'audio/wav' })
    await files._doInit()
    service = new VoiceSessionService()
    await service._doInit()
    a = owner()
  })
  afterEach(async () => {
    await service._doStop()
    await files._doStop()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  async function recording() {
    const sessionId = randomUUID()
    const entry = await service.createRecording(a, { sessionId, audio: webm, mimeType: 'audio/webm;codecs=opus' })
    return { sessionId, requestId: randomUUID(), fileEntryId: entry.id, modelId: APPLE_ASR_MODEL_ID, language: 'en-US' }
  }
  function makeCleanupEligible(id: string) {
    db.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, id))
      .run()
  }

  it('invalid recordings cannot exhaust session admission or attach owner listeners', async () => {
    for (let index = 0; index < 20; index++) {
      await expect(
        service.createRecording(a, {
          sessionId: randomUUID(),
          audio: new Uint8Array([1]),
          mimeType: 'audio/webm;codecs=opus'
        })
      ).rejects.toMatchObject({ reason: 'invalid_audio' })
    }
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
    expect((await recording()).fileEntryId).toBeTruthy()
  })

  it('busy installation requests cannot leave empty sessions behind', async () => {
    const input = await recording()
    let finish!: () => void
    native.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'ready' })
        })
    )
    const work = service.transcribe(a, input)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    for (let index = 0; index < 20; index++) {
      await expect(
        service.installAsset(a, { sessionId: randomUUID(), requestId: randomUUID(), language: 'en-US' })
      ).rejects.toMatchObject({ reason: 'busy' })
    }
    const listenerCount = (a.webContents as unknown as EventEmitter).listenerCount('destroyed')
    finish()
    await work
    expect(listenerCount).toBe(1)
    expect((await recording()).fileEntryId).toBeTruthy()
  })

  it('keeps failed input available for retry and deletes it after a successful transcript', async () => {
    const input = await recording()
    native.transcribe.mockRejectedValueOnce(new VoiceRuntimeError('operation_failed'))
    await expect(service.transcribe(a, input)).rejects.toMatchObject({ reason: 'operation_failed' })
    expect((await files.read(input.fileEntryId, { encoding: 'binary' })).content).toEqual(webm)
    const result = await service.transcribe(a, { ...input, requestId: randomUUID() })
    expect(result.text).toBe('private-transcript')
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
  })

  it('refuses foreign owners and unregistered entries without consuming them', async () => {
    const input = await recording()
    await expect(service.transcribe(owner(), input)).rejects.toMatchObject({ reason: 'forbidden_owner' })
    await expect(service.transcribe(a, { ...input, fileEntryId: randomUUID() })).rejects.toMatchObject({
      reason: 'forbidden_owner'
    })
    expect(fileEntryService.findById(input.fileEntryId)).not.toBeNull()
  })

  it('takes the global lease before resource checks and holds it through cancellation cleanup', async () => {
    const input = await recording()
    let finish: (() => void) | undefined
    native.status.mockImplementationOnce(
      (_id, _options, signal: AbortSignal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              finish = () => resolve({ status: 'ready' })
            },
            { once: true }
          )
        })
    )
    const work = service.transcribe(a, input)
    const outcome = work.then(
      () => 'success',
      (error: VoiceRuntimeError) => error.reason
    )
    await expect(
      service.speech(owner(), {
        sessionId: randomUUID(),
        requestId: randomUUID(),
        modelId: APPLE_TTS_MODEL_ID,
        text: 'private-text',
        voice: 'exact'
      })
    ).rejects.toMatchObject({ reason: 'busy' })
    const abort = service.abort(a, input, 'transcription')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(service.transcribe(a, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ reason: 'busy' })
    finish!()
    await abort
    expect(await outcome).toBe('aborted')
    await service.abort(a, input, 'transcription')
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
  })

  it('only aborts an active operation through its matching route', async () => {
    const input = await recording()
    let signal!: AbortSignal
    native.transcribe.mockImplementation(
      (_id, _audio, _options, activeSignal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = activeSignal
          activeSignal.addEventListener('abort', () => reject(activeSignal.reason), { once: true })
        })
    )
    const work = service.transcribe(a, input)
    const outcome = work.then(
      () => 'success',
      (error: VoiceRuntimeError) => error.reason
    )
    await vi.waitFor(() => expect(signal).toBeDefined())

    await service.abort(a, input, 'speech')
    expect(signal.aborted).toBe(false)

    await service.abort(a, input, 'transcription')
    expect(await outcome).toBe('aborted')
  })

  it('treats active abort as terminal when file deletion keeps failing', async () => {
    const input = await recording()
    makeCleanupEligible(input.fileEntryId)
    native.transcribe.mockImplementation(
      (_id, _audio, _options, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const work = service.transcribe(a, input)
    const settled = work.catch(() => undefined)
    await vi.waitFor(() => expect(native.transcribe).toHaveBeenCalled())
    const deletion = vi
      .spyOn(files, 'deleteRetainedTemporaryEntry')
      .mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }))

    await expect(service.abort(a, input, 'transcription')).resolves.toBeUndefined()
    await settled
    await expect(service.abort(a, input, 'transcription')).resolves.toBeUndefined()
    await files.runEntryCleanup()
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()

    deletion.mockRestore()
    const replacementOwner = owner()
    const replacement = await service.createRecording(replacementOwner, {
      sessionId: input.sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus'
    })
    await service.discard(replacementOwner, input.sessionId)
    expect(fileEntryService.findById(replacement.id)).toBeNull()
  })

  it('owner destruction releases a failed recording and removes its listener', async () => {
    const input = await recording()
    native.transcribe.mockRejectedValueOnce(new VoiceRuntimeError('asset_required'))
    await expect(service.transcribe(a, input)).rejects.toBeInstanceOf(VoiceRuntimeError)
    ;(a.webContents as unknown as EventEmitter).emit('destroyed')
    await vi.waitFor(() => expect(fileEntryService.findById(input.fileEntryId)).toBeNull())
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
  })

  it('owner destruction releases failed deletion ownership for FileManager recovery', async () => {
    const input = await recording()
    makeCleanupEligible(input.fileEntryId)
    const deletion = vi
      .spyOn(files, 'deleteRetainedTemporaryEntry')
      .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EPERM' }))

    ;(a.webContents as unknown as EventEmitter).emit('destroyed')
    await vi.waitFor(() => expect(deletion).toHaveBeenCalledWith(input.fileEntryId))
    await vi.waitFor(async () => {
      await files.runEntryCleanup()
      expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
    })

    const replacementOwner = owner()
    const replacement = await service.createRecording(replacementOwner, {
      sessionId: input.sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus'
    })
    await service.discard(replacementOwner, input.sessionId)
    expect(fileEntryService.findById(replacement.id)).toBeNull()
  })

  it('restores owner cleanup after explicit discard deletion fails', async () => {
    const input = await recording()
    makeCleanupEligible(input.fileEntryId)
    vi.spyOn(files, 'deleteRetainedTemporaryEntry').mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'EPERM' })
    )

    await expect(service.discard(a, input.sessionId)).rejects.toMatchObject({ code: 'EPERM' })
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(1)

    ;(a.webContents as unknown as EventEmitter).emit('destroyed')
    await vi.waitFor(async () => {
      await files.runEntryCleanup()
      expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
    })
  })

  it('escalates cleanup when the owner is destroyed while its listener is reattached', async () => {
    a = ownerDestroyedWhileReattaching()
    const input = await recording()
    makeCleanupEligible(input.fileEntryId)
    vi.spyOn(files, 'deleteRetainedTemporaryEntry').mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'EPERM' })
    )

    await expect(service.discard(a, input.sessionId)).rejects.toMatchObject({ code: 'EPERM' })
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
    await vi.waitFor(async () => {
      await files.runEntryCleanup()
      expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
    })
  })

  it('keeps failed temporary deletion tracked so session cleanup can retry', async () => {
    const input = await recording()
    const physicalPath = files.getPhysicalPath(input.fileEntryId)
    await unlink(physicalPath)
    await mkdir(physicalPath)

    await expect(service.discard(a, input.sessionId)).rejects.toMatchObject({
      code: expect.stringMatching(/^(EPERM|EISDIR)$/)
    })
    expect(fileEntryService.findById(input.fileEntryId)).not.toBeNull()

    await rmdir(physicalPath)
    await expect(service.discard(a, input.sessionId)).resolves.toBeUndefined()
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
  })

  it('returns a complete temporary WAV without a path, then discards its file', async () => {
    const input = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      modelId: APPLE_TTS_MODEL_ID,
      text: 'private-text',
      voice: 'exact'
    }
    const result = await service.speech(a, input)
    expect(result.fileEntry).toMatchObject({
      origin: 'internal',
      ext: 'wav',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(JSON.stringify(result)).not.toContain(root)
    expect((await files.read(result.fileEntry.id, { encoding: 'binary' })).content).toEqual(new Uint8Array(wav()))
    await service.discard(a, input.sessionId)
    expect(fileEntryService.findById(result.fileEntry.id)).toBeNull()
  })

  it.each([
    { requestedSpeed: undefined, expectedSpeed: 1 },
    { requestedSpeed: 1.25, expectedSpeed: 1.25 }
  ])('passes $expectedSpeed× speech speed through AiService', async ({ requestedSpeed, expectedSpeed }) => {
    const input = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      text: 'private-speed-canary',
      voice: 'exact',
      language: 'en-US',
      speed: requestedSpeed
    }

    await service.speech(a, input)

    expect(native.speech.mock.calls[0]?.slice(0, 3)).toEqual([
      APPLE_TTS_MODEL_ID,
      'private-speed-canary',
      { voice: 'exact', language: 'en-US', speed: expectedSpeed }
    ])
  })

  it('treats abort as a no-op after speech completes and leaves cleanup to discard', async () => {
    const input = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      modelId: APPLE_TTS_MODEL_ID,
      text: 'private-text',
      voice: 'exact'
    }
    const result = await service.speech(a, input)

    await service.abort(a, input, 'speech')

    expect(fileEntryService.findById(result.fileEntry.id)).not.toBeNull()
    expect((await files.read(result.fileEntry.id, { encoding: 'binary' })).content).toEqual(new Uint8Array(wav()))
    await service.discard(a, input.sessionId)
    expect(fileEntryService.findById(result.fileEntry.id)).toBeNull()
  })

  it('requires explicit discard before speech can replace a retained recording or output', async () => {
    const input = await recording()
    native.transcribe.mockRejectedValueOnce(new VoiceRuntimeError('operation_failed'))
    await expect(service.transcribe(a, input)).rejects.toMatchObject({ reason: 'operation_failed' })
    const speech = { sessionId: input.sessionId, requestId: randomUUID(), text: 'private-text', voice: 'exact' }
    await expect(service.speech(a, speech)).rejects.toMatchObject({ reason: 'busy' })
    expect((await files.read(input.fileEntryId, { encoding: 'binary' })).content).toEqual(webm)
    await service.discard(a, input.sessionId)
    const result = await service.speech(a, { ...speech, sessionId: randomUUID() })
    await expect(
      service.speech(a, { ...speech, sessionId: result.sessionId, requestId: randomUUID() })
    ).rejects.toMatchObject({ reason: 'busy' })
    expect((await files.read(result.fileEntry.id, { encoding: 'binary' })).content).toEqual(new Uint8Array(wav()))
  })

  it('stop joins an in-flight recording registration and removes the late file', async () => {
    const originalCreate = files.createInternalEntry.bind(files)
    let resume!: () => void
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    vi.spyOn(files, 'createInternalEntry').mockImplementationOnce(async (input) => {
      await gate
      return originalCreate(input)
    })
    const work = service.createRecording(a, {
      sessionId: randomUUID(),
      audio: webm,
      mimeType: 'audio/webm;codecs=opus'
    })
    const failure = expect(work).rejects.toMatchObject({ reason: 'aborted' })
    const stop = service._doStop()
    resume()
    await Promise.all([stop, failure])
    expect(fileEntryService.findMany()).toHaveLength(0)
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
  })

  it('abort removes a TTS file whose registration completes after cancellation', async () => {
    const originalCreate = files.createInternalEntry.bind(files)
    let resume!: () => void
    let started = false
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    vi.spyOn(files, 'createInternalEntry').mockImplementationOnce(async (input) => {
      started = true
      await gate
      return originalCreate(input)
    })
    const input = { sessionId: randomUUID(), requestId: randomUUID(), text: 'private-text', voice: 'exact' }
    const work = service.speech(a, input)
    const failure = expect(work).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(started).toBe(true))
    const abort = service.abort(a, input, 'speech')
    resume()
    await Promise.all([abort, failure])
    expect(fileEntryService.findMany()).toHaveLength(0)
  })

  it('missing resources retain input without invoking inference or substituting another model', async () => {
    const input = await recording()
    native.status.mockResolvedValue({ status: 'not_installed', reason: 'asset_required' })
    await expect(service.transcribe(a, input)).rejects.toMatchObject({ reason: 'asset_required' })
    expect(native.transcribe).not.toHaveBeenCalled()
    expect((await files.read(input.fileEntryId, { encoding: 'binary' })).content).toEqual(webm)
    await service.discard(a, input.sessionId)
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
  })

  it('never logs source text, transcript, bytes or physical paths on success and failure', async () => {
    const input = await recording()
    await service.transcribe(a, input)
    const speech = { sessionId: randomUUID(), requestId: randomUUID(), text: 'private-text', voice: 'exact' }
    native.speech.mockRejectedValueOnce(new Error('private-text private-transcript ' + root))
    await expect(service.speech(a, speech)).rejects.toMatchObject({ reason: 'operation_failed' })
    mockMainLoggerService.warn.mockClear()
    const terminal = await recording()
    vi.spyOn(files, 'deleteRetainedTemporaryEntry').mockRejectedValueOnce(
      Object.assign(new Error('private-text private-transcript ' + root), { code: 'EPERM', path: root, content: webm })
    )
    ;(a.webContents as unknown as EventEmitter).emit('destroyed')
    await vi.waitFor(() =>
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Voice terminal file cleanup failed',
        expect.objectContaining({ sessionId: terminal.sessionId, category: 'operation_failed', code: 'EPERM' })
      )
    )
    const terminalPayloads = mockMainLoggerService.warn.mock.calls
      .filter(([message]) => message === 'Voice terminal file cleanup failed')
      .map(([, payload]) => payload as Record<string, unknown>)
    expect(terminalPayloads).toHaveLength(1)
    expect(Object.keys(terminalPayloads[0]).sort()).toEqual(['category', 'code', 'sessionId'])
    const logs = JSON.stringify(
      ['debug', 'info', 'warn', 'error', 'verbose', 'silly'].map(
        (level) => mockMainLoggerService[level as 'info'].mock.calls
      )
    )
    for (const sensitive of ['private-text', 'private-transcript', root, JSON.stringify([...webm])])
      expect(logs).not.toContain(sensitive)
  })

  it('capability inspection follows owner destruction and holds bounded admission until settled', async () => {
    let probeSignal!: AbortSignal
    let finish!: () => void
    native.status.mockImplementationOnce(
      (_id, _options, signal: AbortSignal) =>
        new Promise((resolve) => {
          probeSignal = signal
          finish = () => resolve({ status: 'ready' })
        })
    )
    const probe = service.status(a, { modelId: APPLE_ASR_MODEL_ID })
    const outcome = probe.then(
      () => 'success',
      (error: VoiceRuntimeError) => error.reason
    )
    await vi.waitFor(() => expect(probeSignal).toBeDefined())
    const simultaneous = await service.status(a, { modelId: APPLE_ASR_MODEL_ID }).then(
      () => 'success',
      (error: VoiceRuntimeError) => error.reason
    )
    ;(a.webContents as unknown as EventEmitter).emit('destroyed')
    const cancelled = probeSignal.aborted
    const speech = await service
      .speech(owner(), { sessionId: randomUUID(), requestId: randomUUID(), text: 'private-text', voice: 'exact' })
      .then(
        () => 'success',
        (error: VoiceRuntimeError) => error.reason
      )
    finish()
    expect(await outcome).toBe('aborted')
    expect(cancelled).toBe(true)
    expect(simultaneous).toBe('busy')
    expect(speech).toBe('busy')
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
  })

  it('stop aborts active work, clears retained input and refuses new requests until restart', async () => {
    const input = await recording()
    native.transcribe.mockImplementation(
      (_id, _audio, _options, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const work = service.transcribe(a, input)
    const failure = expect(work).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(native.transcribe).toHaveBeenCalled())
    await service._doStop()
    await failure
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
    await expect(recording()).rejects.toMatchObject({ reason: 'stopped' })
    await service._doInit()
    expect((await recording()).fileEntryId).toBeTruthy()
  })

  it('stops Voice before FileManager and restarts both without stale ownership', async () => {
    const input = await recording()
    makeCleanupEligible(input.fileEntryId)
    const deletion = vi
      .spyOn(files, 'deleteRetainedTemporaryEntry')
      .mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }))

    await service._doStop()
    await files._doStop()
    deletion.mockRestore()

    await files._doInit()
    await vi.waitFor(() => expect(fileEntryService.findById(input.fileEntryId)).toBeNull())
    await service._doInit()
    const replacementOwner = owner()
    const replacement = await service.createRecording(replacementOwner, {
      sessionId: input.sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus'
    })
    await service.discard(replacementOwner, input.sessionId)
    expect(fileEntryService.findById(replacement.id)).toBeNull()
  })
})
