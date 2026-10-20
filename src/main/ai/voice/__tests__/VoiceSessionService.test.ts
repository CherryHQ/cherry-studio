import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
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
import { MediaProtocolService, MediaKind } from '@main/services/mediaProtocol'
import {
  TranscriptionLanguageSource,
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID,
  QWEN3_TTS_MODEL_ID,
  QWEN3_ASR_MODEL_ID
} from '@shared/ai/localVoice'

import type * as LocalAdapters from '../localAdapters'
import { VoiceCleanupError, VoiceRuntimeError } from '../VoiceRuntimeError'
import { VoiceSessionService, type VoiceOwner } from '../VoiceSessionService'

const native = vi.hoisted(() => ({
  status: vi.fn(),
  transcribe: vi.fn(),
  speech: vi.fn(),
  install: vi.fn(),
  resolveSpeech: vi.fn()
}))
vi.mock('../localAdapters', async (importOriginal) => {
  const { speechFixture, transcriptionFixture } = await import('./voiceExecutionFixtures')
  return {
    ...(await importOriginal<typeof LocalAdapters>()),
    getSpeechOperations: (id: string) => [speechFixture(id, native.speech)],
    getTranscriptionOperations: (id: string) => [transcriptionFixture(id, native.transcribe)],
    getLocalVoiceStatus: native.status,
    listLocalVoices: vi.fn(),
    resolveSpeechConfiguration: (...args: Parameters<typeof LocalAdapters.resolveSpeechConfiguration>) =>
      native.resolveSpeech(...args),
    installVoiceLocale: (_id: string, language: string, signal: AbortSignal) => native.install(language, signal),
    voiceAudioProcess: { id: 'voice.audio' }
  }
})
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
  sleepHolds: new Set<symbol>(),
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
  let media: MediaProtocolService
  let files: InstanceType<typeof FileManager>
  let a: VoiceOwner
  let cleanupFailed: boolean
  beforeEach(async () => {
    cleanupFailed = false
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'darwin' },
        arch: { value: 'arm64' },
        getSystemVersion: { value: () => '26.3' }
      })
    )
    BaseService.resetInstances()
    managedWindows.clear()
    powerEvents.removeAllListeners()
    runtime.broadcastToType.mockReset()
    runtime.send.mockReset()
    runtime.preventSleepDispose.mockReset()
    runtime.sleepHolds.clear()
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
    media = new MediaProtocolService()
    vi.mocked(application.get).mockImplementation(((name: string) => {
      if (name === 'FileManager') return files
      if (name === 'MediaProtocolService') return media
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
          getWindowType: (id: string) => managedWindows.get(id)?.type,
          getWindowIdByWebContents: (contents: VoiceOwner['webContents']) =>
            [...managedWindows].find(([, managed]) => managed.webContents === contents)?.[0]
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
          preventSleep: () => {
            const hold = Symbol()
            runtime.sleepHolds.add(hold)
            return {
              dispose: () => {
                runtime.sleepHolds.delete(hold)
                runtime.preventSleepDispose()
              }
            }
          }
        }
      return defaultServiceInstances[name as keyof typeof defaultServiceInstances]
    }) as typeof application.get)
    vi.mocked(application.getPath).mockImplementation((key, filename) => {
      const directory = key === 'feature.voice.temp' ? path.join(root, 'voice') : root
      return filename ? path.join(directory, filename) : directory
    })
    native.status.mockReset().mockResolvedValue({ status: 'ready' })
    native.transcribe.mockReset().mockResolvedValue({ text: 'private-transcript', segments: [] })
    native.speech.mockReset().mockResolvedValue({ audio: wav(), mediaType: 'audio/wav' })
    native.install.mockReset().mockResolvedValue(undefined)
    native.resolveSpeech.mockReset()
    await files._doInit()
    service = new VoiceSessionService()
    await service._doInit()
    a = owner()
  })
  afterEach(async () => {
    if (cleanupFailed) await expect(service._doStop()).rejects.toThrow('Voice session cleanup failed')
    else await service._doStop()
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
    return {
      sessionId,
      requestId: randomUUID(),
      fileEntryId: entry.id,
      modelId: APPLE_ASR_MODEL_ID,
      language: { source: TranscriptionLanguageSource.Explicit, locale: 'en-US' }
    }
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

  it.each([false, true])('owns incremental speech input through EOF or cancellation (cancel=%s)', async (cancel) => {
    const adapters = await import('../localAdapters')
    const completed = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    const received: string[] = []
    vi.spyOn(adapters, 'getSpeechOperations').mockReturnValue([
      {
        input: 'text-stream',
        output: 'pcm-stream',
        start(input) {
          return {
            output: Promise.resolve({
              kind: 'pcm-stream',
              format: { sampleRate: 24000, channels: 1 },
              chunks: {
                async *[Symbol.asyncIterator]() {
                  let frame = 0
                  try {
                    for await (const event of input.events) {
                      if (event.type === 'text') {
                        received.push(event.text)
                        yield { startFrame: frame++, samples: new Float32Array([0.5]) }
                      }
                    }
                    completed.resolve()
                  } catch (error) {
                    completed.reject(error)
                    throw error
                  } finally {
                    closed.resolve()
                  }
                }
              }
            }),
            completed: completed.promise,
            closed: closed.promise,
            cancel: () => {
              completed.reject(new VoiceRuntimeError('aborted'))
              closed.resolve()
              return closed.promise
            }
          }
        }
      }
    ])
    void completed.promise.catch(() => undefined)
    const { input, result } = await speech(a, {
      modelId: QWEN3_TTS_MODEL_ID,
      voice: 'vivian',
      language: 'en-US',
      text: 'First.',
      textStream: true
    })
    const identity = { sessionId: input.sessionId, requestId: input.requestId }
    service.attachStream(a, { ...identity, attemptId: result.playback.attemptId })
    await vi.waitFor(() => expect(received).toEqual(['First.']))
    expect(() =>
      service.writeText(owner(), { ...identity, sequence: 0, event: { type: 'text', text: 'Forbidden.' } })
    ).toThrow(new VoiceRuntimeError('forbidden_owner'))
    expect(() =>
      service.writeText(a, { ...identity, requestId: randomUUID(), sequence: 0, event: { type: 'flush' } })
    ).toThrow()
    await service.writeText(a, { ...identity, sequence: 0, event: { type: 'text', text: 'Tail.' } })
    if (cancel) {
      await service.abort(a, identity, 'speech')
      await expect(completed.promise).rejects.toMatchObject({ reason: 'aborted' })
    } else {
      service.finishText(a, { ...identity, sequence: 1 })
      await completed.promise
      await vi.waitFor(() => expect(runtime.send.mock.calls.some((call) => call[2]?.type === 'end')).toBe(true))
      expect(received).toEqual(['First.', 'Tail.'])
    }
    await closed.promise
    await expect(
      Promise.resolve().then(() => service.writeText(a, { ...identity, sequence: 1, event: { type: 'flush' } }))
    ).rejects.toMatchObject({ reason: expect.any(String) })
  })

  it('authorizes PCM against both owner and request and waits for input EOF before completion', async () => {
    const adapters = await import('../localAdapters')
    vi.spyOn(adapters, 'getTranscriptionOperations').mockReturnValue([
      {
        input: 'pcm-stream',
        output: 'revisions',
        start(input) {
          let resolve!: (result: { text: string; segments: [] }) => void
          let reject!: (error: unknown) => void
          const completed = new Promise<{ text: string; segments: [] }>((yes, no) => {
            resolve = yes
            reject = no
          })
          const closed = completed.then(
            () => undefined,
            () => undefined
          )
          return {
            ready: Promise.resolve(),
            completed,
            closed,
            cancel: async () => {
              await closed
            },
            updates: {
              async *[Symbol.asyncIterator]() {
                let frames = 0
                try {
                  for await (const chunk of input.chunks) {
                    frames += chunk.samples.length
                    yield { revision: frames, text: 'preview', provisionalStart: 0, final: false }
                  }
                  resolve({ text: `accepted ${frames}`, segments: [] })
                } catch (error) {
                  reject(error)
                  throw error
                }
              }
            }
          }
        }
      }
    ])
    const identity = { sessionId: randomUUID(), requestId: randomUUID() }
    await service.startRecording(a, { ...identity, source: 'dictation' })
    identity.requestId = randomUUID()
    const result = service.startStreamingTranscription(a, {
      ...identity,
      modelId: QWEN3_ASR_MODEL_ID,
      format: { sampleRate: 16000, channels: 1 }
    })
    await vi.waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith(a.windowId, 'ai.voice.transcript_event', { ...identity, type: 'ready' })
    )
    const chunk = { ...identity, startFrame: 0, samples: new Float32Array(131) }
    expect(() => service.writeInput(owner(), chunk)).toThrow(VoiceRuntimeError)
    expect(() => service.writeInput(a, { ...chunk, requestId: randomUUID() })).toThrow(VoiceRuntimeError)
    await service.writeInput(a, chunk)
    expect(service.getState(a).phase).toBe('recording')
    service.finishInput(a, { ...identity, frames: 131 })
    await expect(result).resolves.toEqual({ text: 'accepted 131' })
    expect(service.getState(a).phase).toBe('idle')
    expect(() => service.writeInput(a, chunk)).toThrow(VoiceRuntimeError)
  })

  it('publishes a stream before producer completion, isolates owners and retains playback until acknowledged EOF', async () => {
    const finished = Promise.withResolvers<void>()
    const adapters = await import('../localAdapters')
    vi.spyOn(adapters, 'getSpeechOperations').mockReturnValue([
      {
        input: 'text',
        output: 'pcm-stream',
        start: () => ({
          output: Promise.resolve({
            kind: 'pcm-stream',
            format: { sampleRate: 24000, channels: 1 },
            chunks: (async function* () {
              yield { startFrame: 0, samples: new Float32Array(4096).fill(0.2) }
              await finished.promise
            })()
          }),
          completed: finished.promise,
          closed: finished.promise,
          cancel: async () => {
            finished.resolve()
          }
        })
      }
    ])
    const { input, result } = await speech(a, {
      modelId: QWEN3_TTS_MODEL_ID,
      voice: 'ryan',
      language: 'en-US',
      preferStream: true
    })
    expect(result.output).toMatchObject({ kind: 'pcm-stream', sampleRate: 24000, channels: 1 })
    expect(result.playback.synthesis).toBe('generating')
    const identity = { sessionId: input.sessionId, requestId: input.requestId, attemptId: result.playback.attemptId }
    expect(runtime.send.mock.calls.filter((call) => call[1] === 'ai.voice.stream_event')).toEqual([])
    expect(() => service.attachStream(owner(), identity)).toThrow('forbidden_owner')
    service.attachStream(a, identity)
    await vi.waitFor(() => expect(runtime.send.mock.calls.some((call) => call[2].type === 'pcm')).toBe(true))
    await service.reportPlayback(a, { ...identity, commandRevision: 0, phase: 'playing' })
    finished.resolve()
    await vi.waitFor(() =>
      expect(service.getState(a)).toMatchObject({ phase: 'playing', playback: { synthesis: 'completed' } })
    )
    service.acknowledgeStream(a, { ...identity, attemptId: identity.attemptId + 1, frames: 4096 })
    await expect(
      service.reportPlayback(a, { ...identity, commandRevision: 0, phase: 'completed' })
    ).rejects.toMatchObject({ reason: 'invalid_request' })
    service.acknowledgeStream(a, { ...identity, frames: 4096 })
    await expect(
      service.reportPlayback(a, { ...identity, commandRevision: 0, phase: 'completed' })
    ).resolves.toMatchObject({ phase: 'idle' })
  })

  it('closes the old stream before retry admission and gives the replacement a fresh attempt', async () => {
    const adapters = await import('../localAdapters')
    const lifetimes: Array<ReturnType<typeof Promise.withResolvers<void>>> = []
    vi.spyOn(adapters, 'getSpeechOperations').mockReturnValue([
      {
        input: 'text',
        output: 'pcm-stream',
        start: () => {
          const lifetime = Promise.withResolvers<void>()
          lifetimes.push(lifetime)
          return {
            output: Promise.resolve({
              kind: 'pcm-stream',
              format: { sampleRate: 24000, channels: 1 },
              chunks: (async function* () {
                await lifetime.promise
                yield { startFrame: 0, samples: new Float32Array(1) }
              })()
            }),
            completed: lifetime.promise,
            closed: lifetime.promise,
            cancel: async () => {
              lifetime.resolve()
            }
          }
        }
      }
    ])
    const { input, result } = await speech(a, {
      modelId: QWEN3_TTS_MODEL_ID,
      voice: 'ryan',
      language: 'en-US',
      preferStream: true,
      chunkIndex: 0,
      chunkCount: 1
    })
    await service.reportPlayback(a, {
      sessionId: input.sessionId,
      attemptId: result.playback.attemptId,
      commandRevision: 0,
      phase: 'failed'
    })
    const retry = await service.controlPlayback(a, { sessionId: input.sessionId, command: 'retry' })
    expect(retry.phase).not.toBe('idle')
    if (retry.phase === 'idle') throw new Error('Missing retry admission')
    const replacement = await service.speech(a, {
      ...input,
      requestId: randomUUID(),
      retryAttemptId: retry.playback!.attemptId
    })
    expect(replacement.playback.attemptId).toBeGreaterThan(result.playback.attemptId)
    expect(lifetimes).toHaveLength(2)
    await service.discard(a, input.sessionId)
    expect(service.getState(a).phase).toBe('idle')
  })
  async function report(
    ownerValue: VoiceOwner,
    input: {
      sessionId: string
      phase: Parameters<VoiceSessionService['reportPlayback']>[1]['phase']
      reason?: 'operation_failed'
    }
  ) {
    const state = service.getState(ownerValue)
    if (state.phase === 'idle' || !state.playback) throw new Error('Expected a playback session')
    return service.reportPlayback(ownerValue, {
      ...input,
      attemptId: state.playback.attemptId,
      commandRevision: state.playback.commandRevision
    })
  }

  it('exposes a stoppable playback session to other windows during preference resolution', async () => {
    const resolving = Promise.withResolvers<void>()
    native.resolveSpeech.mockImplementationOnce(
      (_input, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new VoiceRuntimeError('aborted')), { once: true })
          resolving.resolve()
        })
    )
    const started = speech(a, { preferenceResolution: true })
    const cancelled = started.catch((error: unknown) => error)
    await resolving.promise

    const other = owner()
    const state = service.getState(other)
    expect(state).toMatchObject({
      phase: 'generating',
      playback: { availableCommands: expect.arrayContaining(['stop']) }
    })
    if (state.phase === 'idle') throw new Error('Missing pending playback session')
    await service.controlPlayback(other, { sessionId: state.sessionId, command: 'stop' })
    await report(a, { sessionId: state.sessionId, phase: 'stopped' })
    await expect(cancelled).resolves.toMatchObject({ reason: 'aborted' })

    expect(native.speech).not.toHaveBeenCalled()
    expect(service.getState(other).phase).toBe('idle')
    const next = await speech(a, { trigger: 'auto_read' })
    expect(outputResponse(next.result.output.id).status).toBe(200)
  })

  it('releases playback ownership after preference resolution fails', async () => {
    native.resolveSpeech.mockRejectedValueOnce(new VoiceRuntimeError('voice_unavailable'))
    await expect(speech(a, { preferenceResolution: true })).rejects.toMatchObject({ reason: 'voice_unavailable' })
    expect(service.getState(a).phase).toBe('idle')
    const next = await speech(a, { trigger: 'auto_read' })
    expect(outputResponse(next.result.output.id).status).toBe(200)
  })
  function outputResponse(id: string): Response {
    return (media as unknown as { handleRequest(request: Request): Response }).handleRequest(
      new Request(media.getUrl(MediaKind.Audio, id))
    )
  }
  async function outputBytes(id: string) {
    return new Uint8Array(await outputResponse(id).arrayBuffer())
  }

  function makeCleanupEligible(id: string) {
    db.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, id))
      .run()
  }

  it('does not interrupt playback when settings request microphone authorization', async () => {
    const playback = await speech()
    await expect(
      service.startRecording(owner(), { sessionId: randomUUID(), requestId: randomUUID(), source: 'settings' })
    ).rejects.toMatchObject({ reason: 'busy' })
    expect(service.getState(a)).toMatchObject({ phase: 'ready', sessionId: playback.input.sessionId })
    expect(outputResponse(playback.result.output.id).status).toBe(200)
  })

  it.each([{ voice: 'changed' }, { language: 'ja-JP' }, { speed: 1.5 }])(
    'rejects speech parameter changes between chunks: %j',
    async (change) => {
      const sessionId = randomUUID()
      const first = await speech(a, { sessionId, chunkIndex: 0, chunkCount: 2 })
      await service.releaseOutput(a, { sessionId, outputId: first.result.output.id })
      await expect(
        service.speech(a, { ...first.input, ...change, requestId: randomUUID(), chunkIndex: 1 })
      ).rejects.toMatchObject({ reason: 'invalid_request' })
      const second = await service.speech(a, { ...first.input, requestId: randomUUID(), chunkIndex: 1 })
      expect(second.output).toMatchObject({ kind: 'audio', mimeType: 'audio/wav' })
    }
  )

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
  })

  it('rejects a second recording without interrupting the admitted capture', async () => {
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    const challenger = owner()

    await expect(
      service.startRecording(challenger, { sessionId: randomUUID(), requestId: randomUUID(), source: 'dictation' })
    ).rejects.toMatchObject({ reason: 'busy' })

    expect(service.getState(a)).toMatchObject({ phase: 'recording', sessionId })
    const entry = await service.createRecording(a, {
      sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    expect(await files.read(entry.id, { encoding: 'binary' })).toMatchObject({ content: webm })
    expect((challenger.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
  })

  it('rejects a second recording while recognition retains its input and completes', async () => {
    const input = await recording()
    let finish!: () => void
    let activeSignal!: AbortSignal
    native.transcribe.mockImplementationOnce(
      (_model, _audio, _options, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          activeSignal = signal
          finish = () => resolve({ text: 'retained transcript', segments: [] })
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const transcription = service.transcribe(a, input)
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    const challenger = owner()
    const admission = service.startRecording(challenger, {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      source: 'dictation'
    })
    const admissionOutcome = admission.then(
      () => 'admitted',
      (error: VoiceRuntimeError) => error.reason
    )
    const transcriptionOutcome = transcription.then(
      (value) => value.text,
      (error: VoiceRuntimeError) => error.reason
    )
    await admissionOutcome
    const retained = fileEntryService.findById(input.fileEntryId)
    const wasAborted = activeSignal.aborted
    finish()

    expect(await admissionOutcome).toBe('busy')
    expect(wasAborted).toBe(false)
    expect(retained).not.toBeNull()
    expect(await transcriptionOutcome).toBe('retained transcript')
  })

  it('allows microphone capture only for the current recording owner and exact trusted audio request', async () => {
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
      [a.webContents, 'media', trustedUrl, { isMainFrame: false, mediaType: 'audio', requestingUrl: trustedUrl }],
      [
        a.webContents,
        'media',
        'https://evil.test',
        { isMainFrame: true, mediaType: 'audio', requestingUrl: 'https://evil.test' }
      ],
      [a.webContents, 'media', trustedUrl, { isMainFrame: true, mediaType: 'video', requestingUrl: trustedUrl }],
      [a.webContents, 'media', trustedUrl, { isMainFrame: true, requestingUrl: trustedUrl }]
    ] as const) {
      expect(check(...(args as unknown as Parameters<typeof check>))).toBe(false)
    }
    expect(check(a.webContents, 'notifications', trustedUrl, { isMainFrame: true, requestingUrl: trustedUrl })).toBe(
      true
    )

    const allowed = vi.fn()
    request(a.webContents, 'media', allowed, {
      isMainFrame: true,
      requestingUrl: trustedUrl,
      mediaTypes: ['audio']
    })
    expect(allowed).toHaveBeenCalledWith(true)
    let otherOwnerAllowed: boolean | undefined
    request(other.webContents, 'media', (result: boolean) => (otherOwnerAllowed = result), {
      isMainFrame: true,
      requestingUrl: trustedUrl,
      mediaTypes: ['audio']
    })
    expect(otherOwnerAllowed).toBe(false)
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

  it('keeps authorized device discovery available without granting idle capture', async () => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted')
    const trustedUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href
    const check = runtime.permissionCheck!
    const request = runtime.permissionRequest!
    const details = { isMainFrame: true, mediaType: 'audio', requestingUrl: trustedUrl }
    const canDiscover = () => check(a.webContents, 'media', trustedUrl, details)
    const canCapture = () => {
      let allowed: boolean | undefined
      request(a.webContents, 'media', (result: boolean) => (allowed = result), {
        isMainFrame: true,
        requestingUrl: trustedUrl,
        mediaTypes: ['audio']
      })
      return allowed
    }

    expect(canDiscover()).toBe(true)
    expect(canCapture()).toBe(false)
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'settings' })
    expect(canCapture()).toBe(true)
    await service.discard(a, sessionId)
    expect(canDiscover()).toBe(true)
    expect(canCapture()).toBe(false)

    await service._doStop()
    expect(canDiscover()).toBe(false)
    expect(canCapture()).toBe(false)
  })

  it('limits authorized device discovery to live managed app main frames and audio', () => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted')
    const trustedUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href
    const check = runtime.permissionCheck!
    const details = { isMainFrame: true, mediaType: 'audio', requestingUrl: trustedUrl }
    expect(check(a.webContents, 'media', trustedUrl, details)).toBe(true)
    expect(check(a.webContents, 'media', trustedUrl, { ...details, isMainFrame: false })).toBe(false)
    expect(check(a.webContents, 'media', trustedUrl, { ...details, mediaType: 'video' })).toBe(false)
    expect(check(a.webContents, 'media', trustedUrl, { ...details, mediaType: undefined })).toBe(false)
    expect(check(a.webContents, 'media', trustedUrl, { ...details, requestingUrl: 'https://evil.test' })).toBe(false)
    expect(check(a.webContents, 'notifications', trustedUrl, details)).toBe(true)
    expect(check(null, 'media', trustedUrl, details)).toBe(false)
    const destroyed = owner()
    vi.spyOn(destroyed.webContents, 'isDestroyed').mockReturnValue(true)
    expect(check(destroyed.webContents, 'media', trustedUrl, details)).toBe(false)
    managedWindows.delete(a.windowId)
    expect(check(a.webContents, 'media', trustedUrl, details)).toBe(false)
  })

  it('allows trusted clipboard writes with no recording lease and keeps them independent of recording', async () => {
    const trustedUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href
    const check = runtime.permissionCheck!
    const request = runtime.permissionRequest!
    const trusted = { isMainFrame: true, requestingUrl: trustedUrl }
    const requested = (
      contents: VoiceOwner['webContents'],
      permission: string,
      details: { isMainFrame: boolean; requestingUrl: string }
    ) => {
      let allowed: boolean | undefined
      request(contents, permission, (result: boolean) => (allowed = result), details)
      return allowed
    }
    const expectClipboard = (allowed: boolean) => {
      expect(check(a.webContents, 'clipboard-sanitized-write', trustedUrl, trusted)).toBe(allowed)
      expect(requested(a.webContents, 'clipboard-sanitized-write', trusted)).toBe(allowed)
    }

    expectClipboard(true)
    expect(check(a.webContents, 'deprecated-sync-clipboard-read', trustedUrl, trusted)).toBe(false)
    expect(requested(a.webContents, 'deprecated-sync-clipboard-read', trusted)).toBe(false)
    const untrusted = { isMainFrame: true, requestingUrl: 'https://evil.test' }
    expect(check(a.webContents, 'clipboard-sanitized-write', untrusted.requestingUrl, untrusted)).toBe(false)
    expect(requested(a.webContents, 'clipboard-sanitized-write', untrusted)).toBe(false)
    const frame = { ...trusted, isMainFrame: false }
    expect(check(a.webContents, 'clipboard-sanitized-write', trustedUrl, frame)).toBe(false)
    expect(requested(a.webContents, 'clipboard-sanitized-write', frame)).toBe(false)
    expect(check(null, 'clipboard-sanitized-write', trustedUrl, trusted)).toBe(false)

    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    expectClipboard(true)
    await service.discard(a, sessionId)
    expectClipboard(true)
    expect(check(a.webContents, 'deprecated-sync-clipboard-read', trustedUrl, trusted)).toBe(false)
    expect(requested(a.webContents, 'deprecated-sync-clipboard-read', trusted)).toBe(false)
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

  it('revokes microphone capture as soon as recording cleanup starts', async () => {
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
    let allowedDuringCleanup: boolean | undefined
    runtime.permissionRequest!(a.webContents, 'media', (result: boolean) => (allowedDuringCleanup = result), {
      isMainFrame: true,
      mediaTypes: ['audio'],
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
    expect(outputResponse(first.result.output.id).status).toBe(404)
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
      language: { source: TranscriptionLanguageSource.Explicit, locale: 'en-US' }
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
    expect(outputResponse(manual.result.output.id).status).toBe(200)
    const replacement = await speech(owner(), { trigger: 'manual' })
    expect(outputResponse(manual.result.output.id).status).toBe(404)
    expect(service.getState(a)).toMatchObject({ phase: 'ready', sessionId: replacement.input.sessionId })
  })

  it('admits only the winning manual playback when replacements race before generation starts', async () => {
    const displaced = speech(a)
    const winner = speech(owner())

    await expect(displaced).rejects.toMatchObject({ reason: 'aborted' })
    const admitted = await winner
    expect(service.getState(a)).toMatchObject({ phase: 'ready', sessionId: admitted.input.sessionId })
    expect(outputResponse(admitted.result.output.id).status).toBe(200)
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
    await expect(winner).resolves.toMatchObject({ result: { output: { mimeType: 'audio/wav' } } })
    expect((contenderOwner.webContents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0)
  })

  it('gates sequential chunks on owner release and exposes bytes without paths', async () => {
    const sessionId = randomUUID()
    const first = await speech(a, { sessionId, chunkIndex: 0, chunkCount: 2 })
    expect(await outputBytes(first.result.output.id)).toEqual(new Uint8Array(wav()))
    expect(JSON.stringify(first.result)).not.toContain(root)
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
    await expect(service.releaseOutput(owner(), { sessionId, outputId: first.result.output.id })).rejects.toMatchObject(
      { reason: 'forbidden_owner' }
    )
    await service.releaseOutput(a, { sessionId, outputId: first.result.output.id })
    expect(outputResponse(first.result.output.id).status).toBe(404)
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
    expect(second.output.id).not.toBe(first.result.output.id)
    expect(service.getState(a)).toMatchObject({ phase: 'ready', sessionId })
  })

  it('makes release idempotent without allowing an old output to release the next chunk', async () => {
    const sessionId = randomUUID()
    const first = await speech(a, { sessionId, chunkIndex: 0, chunkCount: 2 })
    const release = { sessionId, outputId: first.result.output.id }
    await service.releaseOutput(a, release)
    await service.releaseOutput(a, release)
    expect(outputResponse(release.outputId).status).toBe(404)
    const second = await speech(a, { sessionId, chunkIndex: 1, chunkCount: 2 })
    await expect(service.releaseOutput(a, release)).rejects.toMatchObject({ reason: 'forbidden_owner' })
    expect(await outputBytes(second.result.output.id)).toEqual(new Uint8Array(wav()))
    await service.discard(a, sessionId)
    expect(outputResponse(second.result.output.id).status).toBe(404)
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
    await service.releaseOutput(a, { sessionId, outputId: first.result.output.id })

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
    await service.releaseOutput(a, { sessionId: sourceSessionId, outputId: sourceFirst.result.output.id })
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
    await service.releaseOutput(a, { sessionId: triggerSessionId, outputId: triggerFirst.result.output.id })
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
    await service.releaseOutput(a, { sessionId: entitySessionId, outputId: entityFirst.result.output.id })
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
    await report(a, { sessionId: playback.input.sessionId, phase: 'playing' })
    const paused = await service.controlPlayback(controller, { sessionId: playback.input.sessionId, command: 'pause' })
    expect(paused).toMatchObject({ phase: 'playing', playback: { desired: 'paused', pendingCommand: 'pause' } })
    await report(a, { sessionId: playback.input.sessionId, phase: 'paused' })
    expect(service.getState(a).phase).toBe('paused')
    expect(runtime.send).toHaveBeenLastCalledWith(
      a.windowId,
      'ai.voice.session_event',
      expect.objectContaining({ type: 'command', command: 'pause' })
    )
    await service.controlPlayback(controller, { sessionId: playback.input.sessionId, command: 'stop' })
    await report(a, { sessionId: playback.input.sessionId, phase: 'stopped' })
    expect(service.getState(controller).phase).toBe('idle')
    expect(outputResponse(playback.result.output.id).status).toBe(404)

    const foreignType = owner()
    managedWindows.get(foreignType.windowId)!.type = WindowType.QuickAssistant
    await expect(
      service.controlPlayback(foreignType, { sessionId: playback.input.sessionId, command: 'pause' })
    ).rejects.toMatchObject({ reason: 'forbidden_owner' })
  })

  it.each([WindowType.QuickAssistant, WindowType.SelectionAction])(
    'keeps a new non-owner %s snapshot idle while another window plays',
    async (type) => {
      const playback = await speech(a)
      await report(a, { sessionId: playback.input.sessionId, phase: 'playing' })
      const other = owner()
      managedWindows.get(other.windowId)!.type = type

      const initial = service.getState(other)
      expect(initial).toEqual({ phase: 'idle', revision: service.getState(a).revision })
      expect(service.getState(a)).toMatchObject({ phase: 'playing', sessionId: playback.input.sessionId })
      await service.discard(a, playback.input.sessionId)

      expect(service.getState(other).phase).toBe('idle')
      const ownPlayback = await speech(other)
      expect(service.getState(other)).toMatchObject({ sessionId: ownPlayback.input.sessionId, source: 'playback' })
      expect(service.getState(a)).toEqual(service.getState(other))
      await service.discard(other, ownPlayback.input.sessionId)
      expect(service.getState(other).phase).toBe('idle')
    }
  )

  it.each([WindowType.QuickAssistant, WindowType.SelectionAction])(
    'lets the %s playback owner receive state and control only its own session',
    async (type) => {
      managedWindows.get(a.windowId)!.type = type
      const playback = await speech(a)
      expect(runtime.send.mock.calls).toContainEqual([
        a.windowId,
        'ai.voice.session_event',
        expect.objectContaining({ type: 'state', phase: 'ready', sessionId: playback.input.sessionId })
      ])
      await expect(
        service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'pause' })
      ).resolves.toMatchObject({ playback: { desired: 'paused' } })
      await report(a, { sessionId: playback.input.sessionId, phase: 'paused' })
      await expect(
        service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'resume' })
      ).resolves.toMatchObject({ playback: { desired: 'playing' } })
      await report(a, { sessionId: playback.input.sessionId, phase: 'playing' })

      const foreignOwner = owner()
      managedWindows.get(foreignOwner.windowId)!.type = type
      await expect(
        service.controlPlayback(foreignOwner, { sessionId: playback.input.sessionId, command: 'stop' })
      ).rejects.toMatchObject({ reason: 'forbidden_owner' })
      expect(outputResponse(playback.result.output.id).status).toBe(200)
      await service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'stop' })
      await report(a, { sessionId: playback.input.sessionId, phase: 'stopped' })
      expect(runtime.send.mock.calls).toContainEqual([
        a.windowId,
        'ai.voice.session_event',
        expect.objectContaining({ type: 'state', phase: 'idle' })
      ])
      expect(outputResponse(playback.result.output.id).status).toBe(404)
    }
  )

  it('retries failed playback from the same retained output without regenerating it', async () => {
    const playback = await speech(a)
    const generationCount = native.speech.mock.calls.length
    await report(a, {
      sessionId: playback.input.sessionId,
      phase: 'failed',
      reason: 'operation_failed'
    })

    await service.controlPlayback(owner(), { sessionId: playback.input.sessionId, command: 'retry' })
    await expect(report(a, { sessionId: playback.input.sessionId, phase: 'playing' })).resolves.toMatchObject({
      phase: 'playing',
      sessionId: playback.input.sessionId
    })
    expect(outputResponse(playback.result.output.id).status).toBe(200)
    expect(native.speech).toHaveBeenCalledTimes(generationCount)
  })

  it('lets another window retry a paused failure while rejecting old attempts and foreign reports', async () => {
    const playback = await speech(a)
    const sessionId = playback.input.sessionId
    const old = playback.result.playback
    await service.controlPlayback(a, { sessionId, command: 'pause' })
    await service.reportPlayback(a, {
      sessionId,
      attemptId: old.attemptId,
      commandRevision: old.commandRevision,
      phase: 'failed'
    })
    const controller = owner()
    const retrying = await service.controlPlayback(controller, { sessionId, command: 'retry' })
    expect(retrying).toMatchObject({ phase: 'ready', playback: { desired: 'playing', pendingCommand: 'retry' } })
    await service.reportPlayback(a, {
      sessionId,
      attemptId: old.attemptId,
      commandRevision: old.commandRevision,
      phase: 'failed'
    })
    expect(service.getState(controller)).toEqual(retrying)
    await expect(report(controller, { sessionId, phase: 'playing' })).rejects.toMatchObject({
      reason: 'forbidden_owner'
    })
    await report(a, { sessionId, phase: 'playing' })
    expect(service.getState(controller)).toMatchObject({
      phase: 'playing',
      playback: { availableCommands: ['pause', 'stop'] }
    })
    expect(outputResponse(playback.result.output.id).status).toBe(200)
  })

  it('reports missing control confirmation without releasing still-owned audio', async () => {
    const playback = await speech(a)
    await report(a, { sessionId: playback.input.sessionId, phase: 'playing' })
    vi.useFakeTimers()
    try {
      await service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'stop' })
      await vi.advanceTimersByTimeAsync(15_001)
      expect(service.getState(a)).toMatchObject({
        phase: 'failed',
        playback: {
          pendingCommand: null,
          availableCommands: ['stop'],
          failure: { stage: 'control' }
        }
      })
      expect(outputResponse(playback.result.output.id).status).toBe(200)
      await service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'stop' })
      await report(a, { sessionId: playback.input.sessionId, phase: 'stopped' })
      expect(service.getState(a).phase).toBe('idle')
      expect(outputResponse(playback.result.output.id).status).toBe(404)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps failed execution cleanup observable and prevents a new operation on that session', async () => {
    cleanupFailed = true
    native.speech.mockRejectedValueOnce(new VoiceCleanupError())
    const sessionId = randomUUID()
    await expect(
      service.speech(a, {
        sessionId,
        requestId: randomUUID(),
        text: 'Hello',
        voice: 'exact',
        modelId: APPLE_TTS_MODEL_ID
      })
    ).rejects.toMatchObject({ reason: 'operation_failed' })
    await expect(service.discard(a, sessionId)).rejects.toBeInstanceOf(VoiceCleanupError)
    await expect(
      service.speech(a, {
        sessionId: randomUUID(),
        requestId: randomUUID(),
        text: 'Again',
        voice: 'exact',
        modelId: APPLE_TTS_MODEL_ID
      })
    ).rejects.toMatchObject({ reason: 'operation_failed' })
  })

  it('cleans on crash/full navigation but ignores same-document and sub-frame navigation', async () => {
    for (const terminalEvent of ['render-process-gone', 'destroyed', 'did-start-navigation'] as const) {
      a = owner()
      const playback = await speech(a)
      const contents = a.webContents as unknown as EventEmitter
      contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: '#same' })
      contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: 'https://frame.test' })
      expect(outputResponse(playback.result.output.id).status).toBe(200)
      if (terminalEvent === 'did-start-navigation') {
        contents.emit(terminalEvent, { isMainFrame: true, isSameDocument: false, url: 'file:///new' })
      } else {
        contents.emit(terminalEvent)
      }
      await vi.waitFor(() => expect(outputResponse(playback.result.output.id).status).toBe(404))
      expect(service.getState(a).phase).toBe('idle')
      for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
        expect(contents.listenerCount(event)).toBe(0)
      }
    }
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
    expect(service.getState(a)).toMatchObject({ phase: 'idle' })
    expect(fileEntryService.findMany()).toHaveLength(0)
    for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
      expect(contents.listenerCount(event)).toBe(0)
    }
  })

  it('pauses playing and ready output on lock/suspend after owner confirmation and never auto-resumes', async () => {
    const playing = await speech(a)
    await report(a, { sessionId: playing.input.sessionId, phase: 'playing' })
    powerEvents.emit('lock')
    expect(service.getState(a)).toMatchObject({ playback: { desired: 'paused', pendingCommand: 'pause' } })
    await report(a, { sessionId: playing.input.sessionId, phase: 'paused' })
    powerEvents.emit('unlock')
    powerEvents.emit('resume')
    expect(service.getState(a).phase).toBe('paused')
    await service.controlPlayback(a, { sessionId: playing.input.sessionId, command: 'stop' })
    await report(a, { sessionId: playing.input.sessionId, phase: 'stopped' })

    const ready = await speech(a)
    powerEvents.emit('suspend')
    await report(a, { sessionId: ready.input.sessionId, phase: 'paused' })
    expect(outputResponse(ready.result.output.id).status).toBe(200)
    expect(await outputBytes(ready.result.output.id)).toEqual(new Uint8Array(wav()))
    powerEvents.emit('resume')
    expect(service.getState(a).phase).toBe('paused')
  })

  it('preserves pause intent across synthesis and waits for confirmed playback on resume', async () => {
    let finish!: () => void
    native.speech.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ audio: wav(), mediaType: 'audio/wav' })
        })
    )
    const pending = speech(a)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const state = service.getState(a)
    if (state.phase === 'idle') throw new Error('Speech admission must precede synthesis')
    powerEvents.emit('lock')
    await report(a, { sessionId: state.sessionId, phase: 'paused' })
    finish()
    const { result } = await pending
    expect(result.playback.desired).toBe('paused')
    await report(a, { sessionId: state.sessionId, phase: 'paused' })
    powerEvents.emit('unlock')
    powerEvents.emit('resume')
    expect(service.getState(a).phase).toBe('paused')
    await service.controlPlayback(a, { sessionId: state.sessionId, command: 'resume' })
    expect(service.getState(a)).toMatchObject({
      phase: 'paused',
      playback: { desired: 'playing', pendingCommand: 'resume' }
    })
    await report(a, { sessionId: state.sessionId, phase: 'playing' })
    expect(service.getState(a).phase).toBe('playing')
  })

  it('notifies Voice consumer windows about power interruption before a session is admitted', () => {
    powerEvents.emit('lock')
    for (const type of [WindowType.Main, WindowType.SubWindow, WindowType.QuickAssistant, WindowType.SelectionAction]) {
      const event = runtime.broadcastToType.mock.calls.find(([windowType]) => windowType === type)?.[2]
      expect(event).toEqual({ type: 'interruption', revision: 1 })
    }
    expect(service.getState(a).phase).toBe('idle')
  })

  it.each(['lock', 'suspend'])('interrupts capture on %s while keeping partial input available', async (event) => {
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    powerEvents.emit(event)
    await Promise.resolve()
    expect(runtime.send.mock.calls).toContainEqual([
      a.windowId,
      'ai.voice.session_event',
      expect.objectContaining({ type: 'command', command: 'interrupt', sessionId })
    ])
    const entry = await service.createRecording(a, {
      sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    expect(service.getState(a)).toMatchObject({ phase: 'recorded', sessionId })
    expect(await files.read(entry.id, { encoding: 'binary' })).toMatchObject({ content: webm })
    const transcription = await service.transcribe(a, {
      sessionId,
      requestId: randomUUID(),
      fileEntryId: entry.id,
      modelId: APPLE_ASR_MODEL_ID
    })
    expect(transcription.text).toBe('private-transcript')
  })

  it('retains captured input when lock arrives before transcription starts', async () => {
    const input = await recording()
    powerEvents.emit('lock')
    await Promise.resolve()
    expect(service.getState(a)).toMatchObject({ phase: 'recorded', sessionId: input.sessionId })
    expect(fileEntryService.findById(input.fileEntryId)).not.toBeNull()
    expect(runtime.send.mock.calls).toContainEqual([
      a.windowId,
      'ai.voice.session_event',
      expect.objectContaining({ type: 'command', command: 'interrupt', sessionId: input.sessionId })
    ])
    expect((await service.transcribe(a, input)).text).toBe('private-transcript')
  })

  it('lets recognition finish after lock without aborting or dropping its input', async () => {
    const input = await recording()
    let finish!: () => void
    let activeSignal!: AbortSignal
    native.transcribe.mockImplementationOnce(
      (_model, _audio, _options, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          activeSignal = signal
          finish = () => resolve({ text: 'preserved recognition', segments: [] })
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const pending = service.transcribe(a, input).then(
      (value) => value.text,
      (error: VoiceRuntimeError) => error.reason
    )
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    powerEvents.emit('lock')
    const retained = fileEntryService.findById(input.fileEntryId)
    const aborted = activeSignal.aborted
    finish()

    expect(await pending).toBe('preserved recognition')
    expect(aborted).toBe(false)
    expect(retained).not.toBeNull()
    expect(service.getState(a).phase).toBe('idle')
  })

  it('releases sleep prevention for retained partial input and reacquires it only during recognition', async () => {
    const sessionId = randomUUID()
    await service.startRecording(a, { sessionId, requestId: randomUUID(), source: 'dictation' })
    expect(runtime.sleepHolds.size).toBe(1)
    powerEvents.emit('lock')
    const entry = await service.createRecording(a, {
      sessionId,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_000
    })
    expect(runtime.sleepHolds.size).toBe(0)
    expect(service.getState(a)).toMatchObject({ phase: 'recorded', sessionId })
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    await expect(
      service.startRecording(owner(), { sessionId: randomUUID(), requestId: randomUUID() })
    ).rejects.toMatchObject({ reason: 'busy' })

    let finish!: () => void
    native.transcribe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ text: 'resumed recognition', segments: [] })
        })
    )
    const recognition = service.transcribe(a, {
      sessionId,
      requestId: randomUUID(),
      fileEntryId: entry.id,
      modelId: APPLE_ASR_MODEL_ID
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(runtime.sleepHolds.size).toBe(1)
    finish()
    expect((await recognition).text).toBe('resumed recognition')
    expect(runtime.sleepHolds.size).toBe(0)
  })

  it('releases sleep prevention for ready and paused output and reacquires it on explicit resume', async () => {
    const playback = await speech()
    expect(runtime.sleepHolds.size).toBe(0)
    await report(a, { sessionId: playback.input.sessionId, phase: 'playing' })
    expect(runtime.sleepHolds.size).toBe(1)
    powerEvents.emit('lock')
    const current = service.getState(a)
    if (current.phase !== 'idle') await report(a, { sessionId: current.sessionId, phase: 'paused' })
    expect(runtime.sleepHolds.size).toBe(0)
    expect(service.getState(a)).toMatchObject({ phase: 'paused', sessionId: playback.input.sessionId })
    expect(outputResponse(playback.result.output.id).status).toBe(200)
    await service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'resume' })
    await report(a, { sessionId: playback.input.sessionId, phase: 'playing' })
    expect(runtime.sleepHolds.size).toBe(1)
    await service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'pause' })
    await report(a, { sessionId: playback.input.sessionId, phase: 'paused' })
    expect(runtime.sleepHolds.size).toBe(0)
    await service.controlPlayback(a, { sessionId: playback.input.sessionId, command: 'stop' })
    await report(a, { sessionId: playback.input.sessionId, phase: 'stopped' })
    expect(runtime.sleepHolds.size).toBe(0)
  })

  it('holds sleep prevention only until paused in-flight generation settles', async () => {
    let finish!: () => void
    native.speech.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ audio: wav(), mediaType: 'audio/wav' })
        })
    )
    const generation = speech()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    powerEvents.emit('lock')
    const current = service.getState(a)
    if (current.phase !== 'idle') await report(a, { sessionId: current.sessionId, phase: 'paused' })
    expect(service.getState(a).phase).toBe('paused')
    expect(runtime.sleepHolds.size).toBe(1)
    finish()
    const playback = await generation
    await report(a, { sessionId: playback.input.sessionId, phase: 'paused' })
    expect(service.getState(a).phase).toBe('paused')
    expect(runtime.sleepHolds.size).toBe(0)
    expect(outputResponse(playback.result.output.id).status).toBe(200)
  })

  it('removes orphan scratch at startup and keeps neighboring managed files intact', async () => {
    await service._doStop()
    const directory = application.getPath('feature.voice.temp')
    const orphan = path.join(directory, randomUUID())
    const sibling = path.join(root, 'unrelated.wav')
    await mkdir(orphan, { recursive: true })
    await writeFile(path.join(orphan, 'input.wav'), wav())
    await writeFile(sibling, wav())
    await service._doInit()

    expect(await readdir(directory)).toEqual([])
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    expect(await readFile(sibling)).toEqual(wav())
    expect((await speech()).result.output).toMatchObject({ kind: 'audio', mimeType: 'audio/wav' })
  })

  it('drains scratch work before restart reconciliation removes stale directories', async () => {
    const directory = path.join(application.getPath('feature.voice.temp'), randomUUID())
    const scratchFile = path.join(directory, 'output.wav')
    let finish!: () => void
    native.speech.mockImplementationOnce(async (_model, _text, _options, signal: AbortSignal) => {
      await mkdir(directory)
      await writeFile(scratchFile, wav())
      await new Promise<void>((resolve) => (finish = resolve))
      signal.throwIfAborted()
      return { audio: wav(), mediaType: 'audio/wav' }
    })
    const pending = speech().then(
      () => 'completed',
      (error: VoiceRuntimeError) => error.reason
    )
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    let stopped = false
    const stop = service._doStop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(await readFile(scratchFile)).toEqual(wav())
    finish()
    expect(await pending).toBe('aborted')
    await stop
    await service._doInit()
    expect(await readdir(application.getPath('feature.voice.temp'))).toEqual([])
    expect((await speech()).result.output).toMatchObject({ kind: 'audio', mimeType: 'audio/wav' })
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
      language: { source: TranscriptionLanguageSource.Explicit, locale: 'en-US' }
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
      .installAsset(a, {
        sessionId: randomUUID(),
        requestId: randomUUID(),
        modelId: APPLE_ASR_MODEL_ID,
        language: 'en-US'
      })
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
    native.transcribe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ text: 'private-transcript', segments: [] })
        })
    )
    const work = service.transcribe(a, input)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    for (let index = 0; index < 20; index++) {
      await expect(
        service.installAsset(a, {
          sessionId: randomUUID(),
          requestId: randomUUID(),
          modelId: APPLE_ASR_MODEL_ID,
          language: 'en-US'
        })
      ).rejects.toMatchObject({ reason: 'busy' })
    }
    const listenerCount = (a.webContents as unknown as EventEmitter).listenerCount('destroyed')
    finish()
    await work
    expect(listenerCount).toBe(1)
    expect((await recording()).fileEntryId).toBeTruthy()
  })

  it.each([APPLE_ASR_MODEL_ID, WINDOWS_ASR_MODEL_ID])(
    'keeps failed %s input for retry and deletes it on success',
    async (modelId) => {
      if (modelId === WINDOWS_ASR_MODEL_ID)
        vi.stubGlobal(
          'process',
          Object.defineProperties(Object.create(process), { platform: { value: 'win32' }, arch: { value: 'x64' } })
        )
      const input = { ...(await recording()), modelId }
      native.transcribe.mockRejectedValueOnce(new VoiceRuntimeError('operation_failed'))
      await expect(service.transcribe(a, input)).rejects.toMatchObject({ reason: 'operation_failed' })
      expect((await files.read(input.fileEntryId, { encoding: 'binary' })).content).toEqual(webm)
      const result = await service.transcribe(a, { ...input, requestId: randomUUID() })
      expect(result.text).toBe('private-transcript')
      expect(native.transcribe).toHaveBeenLastCalledWith(modelId, webm, { language: 'en-US' }, expect.any(AbortSignal))
      expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
    }
  )

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
    native.transcribe.mockImplementationOnce(
      (_id, _audio, _options, signal: AbortSignal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              finish = () => resolve({ text: 'private-transcript', segments: [] })
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
    await vi.waitFor(() => expect(native.transcribe).toHaveBeenCalledOnce())
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

  it('resolves omitted speech model to Windows x64 and returns its owned WAV', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'win32' },
        arch: { value: 'x64' }
      })
    )
    native.speech.mockImplementation(async (modelId, _text, options) => {
      if (modelId !== WINDOWS_TTS_MODEL_ID || options.speed !== 1.5) throw new VoiceRuntimeError('unsupported')
      return { audio: wav(), mediaType: 'audio/wav' }
    })
    const input = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      text: 'Windows speech',
      voice: 'exact',
      speed: 1.5
    }
    const result = await service.speech(a, input)
    expect(await outputBytes(result.output.id)).toEqual(new Uint8Array(wav()))
    expect(service.listModels().defaultSpeechModelId).toBe(WINDOWS_TTS_MODEL_ID)
    await service.discard(a, input.sessionId)
    expect(outputResponse(result.output.id).status).toBe(404)
  })

  it('rejects unsupported platform defaults without retaining empty sessions', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'win32' },
        arch: { value: 'ia32' }
      })
    )
    for (let index = 0; index < 17; index++) {
      await expect(
        service.speech(a, { sessionId: randomUUID(), requestId: randomUUID(), text: 'speech', voice: 'exact' })
      ).rejects.toMatchObject({ reason: 'unsupported' })
    }
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'win32' },
        arch: { value: 'x64' }
      })
    )
    const result = await service.speech(a, {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      text: 'speech',
      voice: 'exact'
    })
    expect(result.output.kind === 'audio' && result.output.mimeType).toBe('audio/wav')
  })

  it('preserves an explicit cross-platform speech selection when its readiness rejects it', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'win32' },
        arch: { value: 'x64' }
      })
    )
    native.speech.mockRejectedValueOnce(new VoiceRuntimeError('unsupported'))
    await expect(
      service.speech(a, {
        sessionId: randomUUID(),
        requestId: randomUUID(),
        modelId: APPLE_TTS_MODEL_ID,
        text: 'speech',
        voice: 'exact'
      })
    ).rejects.toMatchObject({ reason: 'unsupported' })
  })

  it('returns a complete WAV URL without a file entry, then revokes its output', async () => {
    const input = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      modelId: APPLE_TTS_MODEL_ID,
      text: 'private-text',
      voice: 'exact'
    }
    const result = await service.speech(a, input)
    expect(result.output).toMatchObject({ mimeType: 'audio/wav', url: media.getUrl(MediaKind.Audio, result.output.id) })
    expect(fileEntryService.findMany()).toHaveLength(0)
    expect(JSON.stringify(result)).not.toContain(root)
    expect(await outputBytes(result.output.id)).toEqual(new Uint8Array(wav()))
    await service.discard(a, input.sessionId)
    expect(outputResponse(result.output.id).status).toBe(404)
  })

  it.each([
    { requestedSpeed: undefined, expectedSpeed: 1 },
    { requestedSpeed: 1.25, expectedSpeed: 1.25 }
  ])('passes $expectedSpeed× speech speed through unified execution', async ({ requestedSpeed, expectedSpeed }) => {
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

    expect(outputResponse(result.output.id).status).toBe(200)
    expect(await outputBytes(result.output.id)).toEqual(new Uint8Array(wav()))
    await service.discard(a, input.sessionId)
    expect(outputResponse(result.output.id).status).toBe(404)
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
    expect(await outputBytes(result.output.id)).toEqual(new Uint8Array(wav()))
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

  it('does not register audio returned after cancellation', async () => {
    let finish!: (value: unknown) => void
    native.speech.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const input = { sessionId: randomUUID(), requestId: randomUUID(), text: 'late', voice: 'exact' }
    const work = service.speech(a, input)
    const failure = expect(work).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const abort = service.abort(a, input, 'speech')
    finish({ audio: wav(), mediaType: 'audio/wav' })
    await Promise.all([abort, failure])
    expect(
      (media as unknown as { stores: Map<string, Map<string, unknown>> }).stores.get(MediaKind.Audio)?.size ?? 0
    ).toBe(0)
    expect(fileEntryService.findMany()).toHaveLength(0)
  })

  it('missing resources retain input without invoking inference or substituting another model', async () => {
    const input = { ...(await recording()), modelId: FUNASR_MODEL_ID, language: undefined }
    native.transcribe.mockRejectedValueOnce(new VoiceRuntimeError('model_required'))
    await expect(service.transcribe(a, input)).rejects.toMatchObject({ reason: 'model_required' })
    expect((await files.read(input.fileEntryId, { encoding: 'binary' })).content).toEqual(webm)
    await service.discard(a, input.sessionId)
    expect(fileEntryService.findById(input.fileEntryId)).toBeNull()
  })

  it('runs ready FunASR through unified execution with the same owned FileEntry and no fallback', async () => {
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
    const input = {
      ...(await recording()),
      modelId: undefined,
      language: { source: TranscriptionLanguageSource.Interface, locale: 'en-US' }
    }

    await expect(service.transcribe(a, input)).resolves.toMatchObject({ text: 'private-transcript' })

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

    expect(outputResponse(playback.result.output.id).status).toBe(404)
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
