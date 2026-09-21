import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { eq } from 'drizzle-orm'
import { session, shell, systemPreferences } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { fileEntryService } from '@data/services/FileEntryService'
import { BaseService } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID } from '@shared/ai/localVoice'

import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { VoiceSessionService, type VoiceOwner } from '../VoiceSessionService'

const native = vi.hoisted(() => ({ status: vi.fn(), transcribe: vi.fn(), speech: vi.fn(), install: vi.fn() }))
vi.mock('../localAdapters', () => ({
  getLocalVoiceStatus: native.status,
  listLocalVoices: vi.fn(),
  installAppleAsrAsset: native.install,
  voiceAudioProcess: { id: 'voice.audio' }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))
vi.mock('@data/db/restore/restoreJournal', () => ({ hasPendingRestore: () => false }))
const { FileManager } = await import('@main/services/file/FileManager')

const managedWindows = new Map<string, { webContents: VoiceOwner['webContents']; type: WindowType }>()
const powerEvents = new EventEmitter()
const runtime = {
  broadcastToType: vi.fn(),
  send: vi.fn(),
  preventSleepDispose: vi.fn(),
  permissionCheck: undefined as ((...args: any[]) => boolean) | null | undefined,
  permissionRequest: undefined as ((...args: any[]) => void) | null | undefined
}

function owner(): VoiceOwner {
  const events = new EventEmitter()
  const result = {
    windowId: randomUUID(),
    webContents: Object.assign(events, {
      id: Math.random(),
      isDestroyed: () => false
    }) as unknown as VoiceOwner['webContents']
  }
  managedWindows.set(result.windowId, { webContents: result.webContents, type: WindowType.Main })
  return result
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
  const result = {
    windowId: randomUUID(),
    webContents: Object.assign(events, {
      id: Math.random(),
      isDestroyed: () => destroyed
    }) as unknown as VoiceOwner['webContents']
  }
  managedWindows.set(result.windowId, { webContents: result.webContents, type: WindowType.Main })
  return result
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
    managedWindows.clear()
    powerEvents.removeAllListeners()
    runtime.broadcastToType.mockReset()
    runtime.send.mockReset()
    runtime.preventSleepDispose.mockReset()
    runtime.permissionCheck = undefined
    runtime.permissionRequest = undefined
    for (const level of ['debug', 'info', 'warn', 'error', 'verbose', 'silly'] as const) {
      mockMainLoggerService[level].mockClear()
    }
    vi.mocked(shell.openExternal).mockReset().mockResolvedValue(undefined)
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReset().mockReturnValue('not-determined')
    Object.assign(session.defaultSession, {
      setPermissionCheckHandler: vi.fn((handler) => {
        runtime.permissionCheck = handler
      }),
      setPermissionRequestHandler: vi.fn((handler) => {
        runtime.permissionRequest = handler
      })
    })
    MockMainDbServiceUtils.setDb(db.db)
    root = await mkdtemp(path.join(tmpdir(), 'voice-session-'))
    files = new FileManager()
    vi.mocked(application.get).mockImplementation(((name: string) => {
      if (name === 'FileManager') return files
      if (name === 'AiService') return { transcribe: native.transcribe, generateSpeech: native.speech }
      if (name === 'UtilityProcessManager') return { register: vi.fn() }
      if (name === 'IpcApiService') return { broadcastToType: runtime.broadcastToType, send: runtime.send }
      if (name === 'WindowManager')
        return {
          getWindow: (id: string) => {
            const managed = managedWindows.get(id)
            return managed
              ? { webContents: managed.webContents, isDestroyed: () => managed.webContents.isDestroyed() }
              : undefined
          },
          getWindowType: (id: string) => managedWindows.get(id)?.type
        }
      if (name === 'PowerService')
        return {
          onSuspend: (listener: () => void) => {
            powerEvents.on('suspend', listener)
            return { dispose: () => powerEvents.removeListener('suspend', listener) }
          },
          onResume: (listener: () => void) => {
            powerEvents.on('resume', listener)
            return { dispose: () => powerEvents.removeListener('resume', listener) }
          },
          onLockScreen: (listener: () => void) => {
            powerEvents.on('lock', listener)
            return { dispose: () => powerEvents.removeListener('lock', listener) }
          },
          onUnlockScreen: (listener: () => void) => {
            powerEvents.on('unlock', listener)
            return { dispose: () => powerEvents.removeListener('unlock', listener) }
          },
          preventSleep: () => ({ dispose: runtime.preventSleepDispose })
        }
      return defaultServiceInstances[name as keyof typeof defaultServiceInstances]
    }) as typeof application.get)
    vi.mocked(application.getPath).mockImplementation((_key, filename) => (filename ? path.join(root, filename) : root))
    native.status.mockReset().mockResolvedValue({ status: 'ready' })
    native.transcribe.mockReset().mockResolvedValue({ text: 'private-transcript', segments: [] })
    native.speech.mockReset().mockResolvedValue({ audio: wav(), mediaType: 'audio/wav' })
    native.install.mockReset().mockResolvedValue(undefined)
    await files._doInit()
    service = new VoiceSessionService()
    await service._doInit()
    a = owner()
  })
  afterEach(async () => {
    await service._doStop()
    await files._doStop()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await rm(root, { recursive: true, force: true })
  })
  async function recording() {
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    const entry = await service.createRecording(a, {
      sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    return { sessionId, requestId: randomUUID(), fileEntryId: entry.id, modelId: APPLE_ASR_MODEL_ID, language: 'en-US' }
  }

  async function speech(ownerValue = a, input: Partial<Parameters<VoiceSessionService['speech']>[1]> = {}) {
    const request = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      text: 'private-text',
      voice: 'exact',
      source: 'playback' as const,
      trigger: 'manual' as const,
      ...input
    }
    return { input: request, result: await service.speech(ownerValue, request) }
  }
  function makeCleanupEligible(id: string) {
    db.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, id))
      .run()
  }

  it('admits recording before audio and exposes one monotonically revised global state', async () => {
    const sessionId = randomUUID()
    expect(service.getState(a)).toEqual({ phase: 'idle', revision: 0 })
    await expect(
      service.createRecording(a, { sessionId, audio: webm, mimeType: 'audio/webm;codecs=opus', durationMs: 1_000 })
    ).rejects.toMatchObject({ reason: 'invalid_request' })

    const recordingState = await service.startRecording(a, {
      sessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    expect(recordingState).toEqual({ phase: 'recording', revision: 1, sessionId, source: 'dictation' })
    const entry = await service.createRecording(a, {
      sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    expect(service.getState(a)).toEqual({ phase: 'recorded', revision: 2, sessionId, source: 'dictation' })
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    expect(runtime.broadcastToType.mock.calls.map(([type]) => type)).toEqual([
      WindowType.Main,
      WindowType.SubWindow,
      WindowType.Main,
      WindowType.SubWindow
    ])
  })

  it('allows microphone permission only for the current recording owner and exact trusted audio request', async () => {
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    const trustedUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href
    const check = runtime.permissionCheck!
    const request = runtime.permissionRequest!
    const other = owner()

    expect(
      check(a.webContents as never, 'media', trustedUrl, {
        isMainFrame: true,
        mediaType: 'audio',
        requestingUrl: trustedUrl
      })
    ).toBe(true)
    for (const args of [
      [other.webContents, 'media', trustedUrl, { isMainFrame: true, mediaType: 'audio', requestingUrl: trustedUrl }],
      [a.webContents, 'media', trustedUrl, { isMainFrame: false, mediaType: 'audio', requestingUrl: trustedUrl }],
      [
        a.webContents,
        'media',
        'https://evil.test',
        { isMainFrame: true, mediaType: 'audio', requestingUrl: 'https://evil.test' }
      ],
      [a.webContents, 'media', trustedUrl, { isMainFrame: true, mediaType: 'video', requestingUrl: trustedUrl }],
      [a.webContents, 'media', trustedUrl, { isMainFrame: true, requestingUrl: trustedUrl }],
      [a.webContents, 'notifications', trustedUrl, { isMainFrame: true, requestingUrl: trustedUrl }]
    ] as const) {
      expect(check(...(args as unknown as Parameters<typeof check>))).toBe(false)
    }

    const allowed = vi.fn()
    request(a.webContents, 'media', allowed, {
      isMainFrame: true,
      requestingUrl: trustedUrl,
      mediaTypes: ['audio']
    })
    expect(allowed).toHaveBeenCalledWith(true)
    const denied = vi.fn()
    request(a.webContents, 'media', denied, {
      isMainFrame: true,
      requestingUrl: trustedUrl,
      mediaTypes: ['audio', 'video']
    })
    expect(denied).toHaveBeenCalledWith(false)
    const missingMediaTypes = vi.fn()
    request(a.webContents, 'media', missingMediaTypes, {
      isMainFrame: true,
      requestingUrl: trustedUrl
    })
    expect(missingMediaTypes).toHaveBeenCalledWith(false)

    await service._doStop()
    expect(runtime.permissionCheck).toBeNull()
    expect(runtime.permissionRequest).toBeNull()
  })

  it('queries microphone status without prompting and opens only fixed platform settings', async () => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied')
    expect(service.getMicrophoneStatus(a)).toBe('denied')
    expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('microphone')
    expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
    await service.openMicrophoneSettings(a)
    expect(shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    )

    vi.stubGlobal('process', Object.defineProperties(Object.create(process), { platform: { value: 'linux' } }))
    expect(service.getMicrophoneStatus(a)).toBe('unknown')
    await expect(service.openMicrophoneSettings(a)).rejects.toMatchObject({ reason: 'unsupported' })
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('revokes microphone permission as soon as recording cleanup starts', async () => {
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    const createInternalEntry = files.createInternalEntry.bind(files)
    let releaseCreate!: () => void
    const createGate = new Promise<void>((resolve) => (releaseCreate = resolve))
    vi.spyOn(files, 'createInternalEntry').mockImplementationOnce(async (input) => {
      await createGate
      return createInternalEntry(input)
    })
    const capture = service.createRecording(a, {
      sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    await vi.waitFor(() => expect(files.createInternalEntry).toHaveBeenCalled())

    const cleanup = service.discard(a, sessionId)
    const trustedUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href
    const allowedDuringCleanup = runtime.permissionCheck?.(a.webContents, 'media', trustedUrl, {
      isMainFrame: true,
      mediaType: 'audio',
      requestingUrl: trustedUrl
    })

    releaseCreate()
    await expect(capture).rejects.toMatchObject({ reason: 'aborted' })
    await cleanup
    expect(allowedDuringCleanup).toBe(false)
  })

  it('recording preempts playback, while recognition blocks manual playback and auto-read never preempts', async () => {
    const playbackOwner = owner()
    const first = await speech(playbackOwner)
    const recordingSessionId = randomUUID()
    await service.startRecording(a, {
      sessionId: recordingSessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    expect(runtime.send).toHaveBeenCalledWith(
      playbackOwner.windowId,
      'ai.voice.session_event',
      expect.objectContaining({ type: 'command', command: 'stop', sessionId: first.input.sessionId })
    )
    expect(fileEntryService.findById(first.result.fileEntry.id)).toBeNull()
    expect(service.getState(a)).toMatchObject({ phase: 'recording', sessionId: recordingSessionId })

    const entry = await service.createRecording(a, {
      sessionId: recordingSessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    let settle!: (value: { text: string; segments: never[] }) => void
    native.transcribe.mockImplementationOnce(
      () => new Promise((resolve) => (settle = resolve as (value: { text: string; segments: never[] }) => void))
    )
    const recognition = service.transcribe(a, {
      sessionId: recordingSessionId,
      requestId: randomUUID(),
      fileEntryId: entry.id,
      modelId: APPLE_ASR_MODEL_ID,
      language: 'en-US'
    })
    await vi.waitFor(() => expect(service.getState(a).phase).toBe('recognizing'))
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'))
    await expect(speech(owner())).rejects.toMatchObject({ reason: 'busy' })
    settle({ text: 'private-transcript', segments: [] })
    await recognition

    const manual = await speech(playbackOwner)
    await expect(speech(owner(), { trigger: 'auto_read', source: 'playback' })).rejects.toMatchObject({
      reason: 'busy'
    })
    expect(fileEntryService.findById(manual.result.fileEntry.id)).not.toBeNull()
    const replacement = await speech(owner(), { trigger: 'manual' })
    expect(fileEntryService.findById(manual.result.fileEntry.id)).toBeNull()
    expect(service.getState(a)).toMatchObject({ phase: 'ready', sessionId: replacement.input.sessionId })
  })

  it('admits only the winning manual playback when replacements race before generation starts', async () => {
    const displaced = speech(a)
    const winner = speech(owner())

    await expect(displaced).rejects.toMatchObject({ reason: 'aborted' })
    const admitted = await winner
    expect(service.getState(a)).toMatchObject({ phase: 'ready', sessionId: admitted.input.sessionId })
    expect(fileEntryService.findById(admitted.result.fileEntry.id)).not.toBeNull()
    expect(native.speech).toHaveBeenCalledTimes(1)
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
  })

  it('cleans the displaced contender when manual replacements race an active generation', async () => {
    let activeSignal!: AbortSignal
    native.speech.mockImplementationOnce(
      (_model, _text, _options, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          activeSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const active = speech(a)
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    const contenderOwner = owner()
    const contender = speech(contenderOwner)
    const winner = speech(owner())

    await expect(active).rejects.toMatchObject({ reason: 'aborted' })
    await expect(contender).rejects.toMatchObject({ reason: 'aborted' })
    await expect(winner).resolves.toMatchObject({ result: { mimeType: 'audio/wav' } })
    expect((contenderOwner.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
  })

  it('gates sequential chunks on owner release and exposes bytes without paths', async () => {
    const sessionId = randomUUID()
    const first = await speech(a, { sessionId, chunkIndex: 0, chunkCount: 2 })
    const read = await service.readOutput(a, { sessionId, fileEntryId: first.result.fileEntry.id })
    expect(read).toEqual({ audio: new Uint8Array(wav()), mimeType: 'audio/wav' })
    expect(JSON.stringify(read)).not.toContain(root)
    await expect(
      service.speech(a, {
        sessionId,
        requestId: randomUUID(),
        text: 'private-second-chunk',
        voice: 'exact',
        source: 'playback',
        trigger: 'manual',
        chunkIndex: 1,
        chunkCount: 2
      })
    ).rejects.toMatchObject({ reason: 'busy' })
    await expect(
      service.releaseOutput(owner(), { sessionId, fileEntryId: first.result.fileEntry.id })
    ).rejects.toMatchObject({ reason: 'forbidden_owner' })
    await service.releaseOutput(a, { sessionId, fileEntryId: first.result.fileEntry.id })
    expect(fileEntryService.findById(first.result.fileEntry.id)).toBeNull()
    const second = await service.speech(a, {
      sessionId,
      requestId: randomUUID(),
      text: 'private-second-chunk',
      voice: 'exact',
      source: 'playback',
      trigger: 'manual',
      chunkIndex: 1,
      chunkCount: 2
    })
    expect(second.fileEntry.id).not.toBe(first.result.fileEntry.id)
    expect(service.getState(a)).toMatchObject({ phase: 'ready', sessionId })
  })

  it('serializes output release with completion and rejects duplicate release', async () => {
    const playback = await speech(a)
    const deleteRetained = files.deleteRetainedTemporaryEntry.bind(files)
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => (releaseDelete = resolve))
    vi.spyOn(files, 'deleteRetainedTemporaryEntry').mockImplementationOnce(async (id) => {
      await deleteGate
      return deleteRetained(id)
    })

    const release = service.releaseOutput(a, {
      sessionId: playback.input.sessionId,
      fileEntryId: playback.result.fileEntry.id
    })
    await vi.waitFor(() => expect(files.deleteRetainedTemporaryEntry).toHaveBeenCalled())
    await expect(
      service.releaseOutput(a, {
        sessionId: playback.input.sessionId,
        fileEntryId: playback.result.fileEntry.id
      })
    ).rejects.toMatchObject({ reason: 'busy' })
    const completion = service.updatePlayback(a, { sessionId: playback.input.sessionId, phase: 'completed' })

    releaseDelete()
    await release
    await expect(completion).resolves.toMatchObject({ phase: 'idle' })
    expect(fileEntryService.findById(playback.result.fileEntry.id)).toBeNull()
    expect(service.getState(a).phase).toBe('idle')
  })

  it('continues an auto-read session after releasing the previous chunk', async () => {
    const sessionId = randomUUID()
    const first = await speech(a, {
      sessionId,
      sourceEntityId: 'message-1',
      trigger: 'auto_read',
      chunkIndex: 0,
      chunkCount: 2
    })
    await service.releaseOutput(a, { sessionId, fileEntryId: first.result.fileEntry.id })

    await expect(
      service.speech(a, {
        sessionId,
        requestId: randomUUID(),
        text: 'private-second-chunk',
        voice: 'exact',
        source: 'playback',
        sourceEntityId: 'message-1',
        trigger: 'auto_read',
        chunkIndex: 1,
        chunkCount: 2
      })
    ).resolves.toMatchObject({ sessionId })
  })

  it('rejects sequential chunks that change the session source, trigger, or source entity', async () => {
    const sourceSessionId = randomUUID()
    const sourceFirst = await speech(a, { sessionId: sourceSessionId, chunkIndex: 0, chunkCount: 2 })
    await service.releaseOutput(a, { sessionId: sourceSessionId, fileEntryId: sourceFirst.result.fileEntry.id })
    await expect(
      service.speech(a, {
        sessionId: sourceSessionId,
        requestId: randomUUID(),
        text: 'private-second-chunk',
        voice: 'exact',
        source: 'settings',
        trigger: 'manual',
        chunkIndex: 1,
        chunkCount: 2
      })
    ).rejects.toMatchObject({ reason: 'invalid_request' })

    await service.discard(a, sourceSessionId)
    const triggerSessionId = randomUUID()
    const triggerFirst = await speech(a, {
      sessionId: triggerSessionId,
      trigger: 'auto_read',
      chunkIndex: 0,
      chunkCount: 2
    })
    await service.releaseOutput(a, { sessionId: triggerSessionId, fileEntryId: triggerFirst.result.fileEntry.id })
    await expect(
      service.speech(a, {
        sessionId: triggerSessionId,
        requestId: randomUUID(),
        text: 'private-second-chunk',
        voice: 'exact',
        source: 'playback',
        trigger: 'manual',
        chunkIndex: 1,
        chunkCount: 2
      })
    ).rejects.toMatchObject({ reason: 'invalid_request' })

    await service.discard(a, triggerSessionId)
    const entitySessionId = randomUUID()
    const entityFirst = await speech(a, {
      sessionId: entitySessionId,
      sourceEntityId: 'message-1',
      chunkIndex: 0,
      chunkCount: 2
    })
    await service.releaseOutput(a, { sessionId: entitySessionId, fileEntryId: entityFirst.result.fileEntry.id })
    await expect(
      service.speech(a, {
        sessionId: entitySessionId,
        requestId: randomUUID(),
        text: 'private-second-chunk',
        voice: 'exact',
        source: 'playback',
        sourceEntityId: 'message-2',
        trigger: 'manual',
        chunkIndex: 1,
        chunkCount: 2
      })
    ).rejects.toMatchObject({ reason: 'invalid_request' })
  })

  it('accepts owner playback updates and lets another managed main window control it', async () => {
    const playback = await speech(a)
    const controller = owner()
    await service.updatePlayback(a, { sessionId: playback.input.sessionId, phase: 'playing' })
    const paused = await service.controlPlayback(controller, { sessionId: playback.input.sessionId, command: 'pause' })
    expect(paused).toMatchObject({ phase: 'paused', sessionId: playback.input.sessionId })
    expect(runtime.send).toHaveBeenLastCalledWith(
      a.windowId,
      'ai.voice.session_event',
      expect.objectContaining({ type: 'command', command: 'pause' })
    )
    await service.controlPlayback(controller, { sessionId: playback.input.sessionId, command: 'stop' })
    expect(service.getState(controller).phase).toBe('idle')
    expect(fileEntryService.findById(playback.result.fileEntry.id)).toBeNull()

    const foreignType = owner()
    managedWindows.get(foreignType.windowId)!.type = WindowType.QuickAssistant
    await expect(
      service.controlPlayback(foreignType, { sessionId: playback.input.sessionId, command: 'pause' })
    ).rejects.toMatchObject({ reason: 'forbidden_owner' })
  })

  it('retries failed playback from the same retained output without regenerating it', async () => {
    const playback = await speech(a)
    const generationCount = native.speech.mock.calls.length
    await service.updatePlayback(a, {
      sessionId: playback.input.sessionId,
      phase: 'failed',
      reason: 'operation_failed'
    })

    await expect(
      service.updatePlayback(a, { sessionId: playback.input.sessionId, phase: 'playing' })
    ).resolves.toMatchObject({ phase: 'playing', sessionId: playback.input.sessionId })
    expect(fileEntryService.findById(playback.result.fileEntry.id)).not.toBeNull()
    expect(native.speech).toHaveBeenCalledTimes(generationCount)
  })

  it('cleans on crash/full navigation but ignores same-document and sub-frame navigation', async () => {
    for (const terminalEvent of ['render-process-gone', 'destroyed', 'did-start-navigation'] as const) {
      a = owner()
      const playback = await speech(a)
      const contents = a.webContents as unknown as EventEmitter
      contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: '#same' })
      contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: 'https://frame.test' })
      expect(fileEntryService.findById(playback.result.fileEntry.id)).not.toBeNull()
      if (terminalEvent === 'did-start-navigation') {
        contents.emit(terminalEvent, { isMainFrame: true, isSameDocument: false, url: 'file:///new' })
      } else {
        contents.emit(terminalEvent)
      }
      await vi.waitFor(() => expect(fileEntryService.findById(playback.result.fileEntry.id)).toBeNull())
      expect(service.getState(a).phase).toBe('idle')
      for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
        expect(contents.listenerCount(event)).toBe(0)
      }
    }
  })

  it('does not admit recording after its owner navigates while displaced playback cleanup is pending', async () => {
    const playback = await speech(a)
    const deleteRetained = files.deleteRetainedTemporaryEntry.bind(files)
    let continueDelete!: () => void
    vi.spyOn(files, 'deleteRetainedTemporaryEntry').mockImplementationOnce(async (id) => {
      await new Promise<void>((resolve) => (continueDelete = resolve))
      return deleteRetained(id)
    })
    const recordingOwner = owner()
    const sessionId = randomUUID()
    const admission = service.startRecording(recordingOwner, {
      sessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    const failure = expect(admission).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(continueDelete).toBeTypeOf('function'))

    const contents = recordingOwner.webContents as unknown as EventEmitter
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'file:///new' })
    continueDelete()
    await failure

    const trustedUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href
    expect(
      runtime.permissionCheck?.(recordingOwner.webContents, 'media', trustedUrl, {
        isMainFrame: true,
        mediaType: 'audio',
        requestingUrl: trustedUrl
      })
    ).toBe(false)
    expect(service.getState(a)).toEqual({ phase: 'idle', revision: 3 })
    expect(fileEntryService.findMany()).toHaveLength(0)
    for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
      expect(contents.listenerCount(event)).toBe(0)
    }
    expect(fileEntryService.findById(playback.result.fileEntry.id)).toBeNull()
  })

  it('does not admit manual playback after its owner navigates while displaced generation cleanup is pending', async () => {
    let activeSignal!: AbortSignal
    let finishAbort!: () => void
    native.speech.mockImplementationOnce(
      (_model, _text, _options, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          activeSignal = signal
          signal.addEventListener('abort', () => (finishAbort = () => reject(signal.reason)), { once: true })
        })
    )
    const active = speech(a)
    const activeFailure = expect(active).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(activeSignal).toBeDefined())

    const replacementOwner = owner()
    const replacement = speech(replacementOwner)
    const replacementFailure = expect(replacement).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(finishAbort).toBeTypeOf('function'))
    const contents = replacementOwner.webContents as unknown as EventEmitter
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'file:///new' })
    finishAbort()

    await Promise.all([activeFailure, replacementFailure])
    expect(service.getState(a)).toEqual({ phase: 'idle', revision: 2 })
    expect(fileEntryService.findMany()).toHaveLength(0)
    for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
      expect(contents.listenerCount(event)).toBe(0)
    }
  })

  it('pauses playing on lock/suspend, terminates other phases, and never auto-resumes', async () => {
    const playing = await speech(a)
    await service.updatePlayback(a, { sessionId: playing.input.sessionId, phase: 'playing' })
    powerEvents.emit('lock')
    await vi.waitFor(() => expect(service.getState(a).phase).toBe('paused'))
    expect(runtime.send).toHaveBeenLastCalledWith(
      a.windowId,
      'ai.voice.session_event',
      expect.objectContaining({ type: 'command', command: 'pause' })
    )
    powerEvents.emit('unlock')
    powerEvents.emit('resume')
    expect(service.getState(a).phase).toBe('paused')
    await service.controlPlayback(a, { sessionId: playing.input.sessionId, command: 'stop' })

    const ready = await speech(a)
    powerEvents.emit('suspend')
    await vi.waitFor(() => expect(service.getState(a).phase).toBe('idle'))
    expect(fileEntryService.findById(ready.result.fileEntry.id)).toBeNull()
  })

  it('keeps state events and structured logs free of text, transcript, bytes, and paths', async () => {
    const input = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      text: 'private-event-text-canary',
      voice: 'exact',
      source: 'playback' as const,
      sourceEntityId: 'private-playback-entity-canary',
      trigger: 'manual' as const,
      language: 'en-US'
    }
    await service.speech(a, input)
    const recordingSessionId = randomUUID()
    await service.startRecording(a, {
      sessionId: recordingSessionId,
      requestId: randomUUID(),
      source: 'dictation',
      sourceEntityId: 'private-recording-entity-canary'
    })
    const recordingEntry = await service.createRecording(a, {
      sessionId: recordingSessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 4_321
    })
    await service.transcribe(a, {
      sessionId: recordingSessionId,
      requestId: randomUUID(),
      fileEntryId: recordingEntry.id,
      modelId: APPLE_ASR_MODEL_ID,
      language: 'en-US'
    })
    const serializedEvents = JSON.stringify(runtime.broadcastToType.mock.calls)
    const serializedLogs = JSON.stringify(
      ['debug', 'info', 'warn', 'error', 'verbose', 'silly'].flatMap(
        (level) => mockMainLoggerService[level as 'info'].mock.calls
      )
    )
    for (const privateValue of [
      'private-event-text-canary',
      'private-playback-entity-canary',
      'private-recording-entity-canary',
      'private-transcript',
      root,
      JSON.stringify([...webm])
    ]) {
      expect(serializedEvents).not.toContain(privateValue)
      expect(serializedLogs).not.toContain(privateValue)
    }
    expect(serializedLogs).toContain('normalizedTextLength')
    expect(serializedLogs).toContain('durationMs')
    expect(serializedLogs).toContain('4321')
  })

  it('lets recording admission abort an active asset install before taking the lease', async () => {
    let signal!: AbortSignal
    native.install.mockImplementationOnce(
      (_language, activeSignal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = activeSignal
          activeSignal.addEventListener('abort', () => reject(activeSignal.reason), { once: true })
        })
    )
    const installation = service
      .installAsset(a, { sessionId: randomUUID(), requestId: randomUUID(), language: 'en-US' })
      .then(
        () => 'completed',
        (error: VoiceRuntimeError) => error.reason
      )
    await vi.waitFor(() => expect(signal).toBeDefined())

    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    expect(await installation).toBe('aborted')
    expect(service.getState(a)).toMatchObject({ phase: 'recording', sessionId })
  })

  it('serializes concurrent recording starts that both await the displaced lease cleanup', async () => {
    const playback = await speech(a)
    const originalDelete = files.deleteRetainedTemporaryEntry.bind(files)
    let continueDelete!: () => void
    vi.spyOn(files, 'deleteRetainedTemporaryEntry').mockImplementationOnce(async (id) => {
      await new Promise<void>((resolve) => (continueDelete = resolve))
      return originalDelete(id)
    })
    const firstOwner = owner()
    const secondOwner = owner()
    const firstSessionId = randomUUID()
    const secondSessionId = randomUUID()
    const first = service.startRecording(firstOwner, {
      sessionId: firstSessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    await vi.waitFor(() => expect(continueDelete).toBeTypeOf('function'))
    const second = service.startRecording(secondOwner, {
      sessionId: secondSessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    continueDelete()
    await Promise.all([first, second])

    expect(fileEntryService.findById(playback.result.fileEntry.id)).toBeNull()
    expect(service.getState(secondOwner)).toMatchObject({ phase: 'recording', sessionId: secondSessionId })
    expect((firstOwner.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
    expect(runtime.send).toHaveBeenCalledWith(
      firstOwner.windowId,
      'ai.voice.session_event',
      expect.objectContaining({ type: 'command', command: 'stop', sessionId: firstSessionId })
    )
    await expect(
      service.createRecording(firstOwner, {
        sessionId: firstSessionId,
        audio: webm,
        mimeType: 'audio/webm;codecs=opus',
        durationMs: 1
      })
    ).rejects.toMatchObject({ reason: 'invalid_request' })
  })

  it('invalid recordings cannot exhaust session admission or attach owner listeners', async () => {
    for (let index = 0; index < 20; index++) {
      await expect(
        service.createRecording(a, {
          sessionId: randomUUID(),
          audio: new Uint8Array([1]),
          mimeType: 'audio/webm;codecs=opus',
          durationMs: 1_000
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
    await service.startRecording(replacementOwner, {
      sessionId: input.sessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    const replacement = await service.createRecording(replacementOwner, {
      sessionId: input.sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
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
    await service.startRecording(replacementOwner, {
      sessionId: input.sessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    const replacement = await service.createRecording(replacementOwner, {
      sessionId: input.sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
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
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    const work = service.createRecording(a, {
      sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
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
    const input = { ...(await recording()), modelId: FUNASR_MODEL_ID, language: undefined }
    native.status.mockResolvedValue({ status: 'not_installed', reason: 'model_required' })
    await expect(service.transcribe(a, input)).rejects.toMatchObject({ reason: 'model_required' })
    expect(native.transcribe).not.toHaveBeenCalled()
    expect(native.status).toHaveBeenCalledWith(FUNASR_MODEL_ID, input, expect.any(AbortSignal))
    expect((await files.read(input.fileEntryId, { encoding: 'binary' })).content).toEqual(webm)
    await service.discard(a, input.sessionId)
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
  })

  it('runs ready FunASR through AiService with the same owned FileEntry and no fallback', async () => {
    const input = { ...(await recording()), modelId: FUNASR_MODEL_ID, language: undefined }

    await expect(service.transcribe(a, input)).resolves.toMatchObject({ text: 'private-transcript' })

    expect(native.transcribe).toHaveBeenCalledOnce()
    expect(native.transcribe).toHaveBeenCalledWith(
      FUNASR_MODEL_ID,
      webm,
      { language: undefined },
      expect.any(AbortSignal)
    )
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
  })

  it('omits a stale language when the implicit platform default is FunASR', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'linux' },
        arch: { value: 'x64' }
      })
    )
    const input = { ...(await recording()), modelId: undefined, language: 'en-US' }

    await expect(service.transcribe(a, input)).resolves.toMatchObject({ text: 'private-transcript' })

    expect(native.status).toHaveBeenCalledWith(
      FUNASR_MODEL_ID,
      { ...input, language: undefined },
      expect.any(AbortSignal)
    )
    expect(native.transcribe).toHaveBeenCalledWith(
      FUNASR_MODEL_ID,
      webm,
      { language: undefined },
      expect.any(AbortSignal)
    )
    const operationLogs = mockMainLoggerService.debug.mock.calls.filter(([message]) =>
      ['Voice operation started', 'Voice operation settled'].includes(message)
    )
    expect(operationLogs).toHaveLength(2)
    expect(operationLogs.map(([, metadata]) => metadata)).toEqual([
      expect.objectContaining({ modelId: FUNASR_MODEL_ID, locale: undefined }),
      expect.objectContaining({ modelId: FUNASR_MODEL_ID, locale: undefined })
    ])
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

  it('allows concurrent capability inspections while retaining owner cleanup and bounded admission', async () => {
    const probeSignals: AbortSignal[] = []
    const finishes: Array<() => void> = []
    native.status.mockImplementation(
      (_id, _options, signal: AbortSignal) =>
        new Promise((resolve) => {
          probeSignals.push(signal)
          finishes.push(() => resolve({ status: 'ready' }))
        })
    )
    const probe = service.status(a, { modelId: APPLE_ASR_MODEL_ID })
    const outcome = probe.then(
      () => 'success',
      (error: VoiceRuntimeError) => error.reason
    )
    const other = owner()
    const simultaneous = service.status(other, { modelId: APPLE_ASR_MODEL_ID }).then(
      () => 'success',
      (error: VoiceRuntimeError) => error.reason
    )
    await vi.waitFor(() => expect(probeSignals).toHaveLength(2))
    ;(a.webContents as unknown as EventEmitter).emit('destroyed')
    const cancelled = probeSignals[0].aborted
    const otherCancelled = probeSignals[1].aborted
    const speech = await service
      .speech(owner(), { sessionId: randomUUID(), requestId: randomUUID(), text: 'private-text', voice: 'exact' })
      .then(
        () => 'success',
        (error: VoiceRuntimeError) => error.reason
      )
    finishes.forEach((finish) => finish())
    expect(await outcome).toBe('aborted')
    expect(cancelled).toBe(true)
    expect(otherCancelled).toBe(false)
    expect(await simultaneous).toBe('success')
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

  it('destroy performs terminal lease, listener, and permission cleanup even without stop', async () => {
    const playback = await speech(a)

    await service._doDestroy()

    expect(fileEntryService.findById(playback.result.fileEntry.id)).toBeNull()
    expect((a.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
    expect(runtime.permissionCheck).toBeNull()
    expect(runtime.permissionRequest).toBeNull()
    await expect(speech(a)).rejects.toMatchObject({ reason: 'stopped' })
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
    await service.startRecording(replacementOwner, {
      sessionId: input.sessionId,
      requestId: randomUUID(),
      source: 'dictation'
    })
    const replacement = await service.createRecording(replacementOwner, {
      sessionId: input.sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    await service.discard(replacementOwner, input.sessionId)
    expect(fileEntryService.findById(replacement.id)).toBeNull()
  })
})
