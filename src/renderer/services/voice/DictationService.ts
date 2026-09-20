import { voiceErrorCodes, type VoiceErrorReason } from '@shared/ipc/errors/voice'

import {
  voiceService,
  type CreateRecordingInput,
  type StartRecordingInput,
  type TranscriptionInput,
  type VoiceOperation
} from './VoiceService'
import { voiceTargetManager, type CapturedVoiceTarget, type VoiceTargetInsertResult } from './VoiceTargetManager'

const RECORDING_MIME_TYPE = 'audio/webm;codecs=opus'
const MAX_RECORDING_DURATION_MS = 300_000
const ELAPSED_UPDATE_INTERVAL_MS = 1_000

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing' | 'failed' | 'recovery'

export type DictationErrorCategory =
  | VoiceErrorReason
  | 'microphone_permission'
  | 'recording_failed'
  | 'transcription_failed'
  | 'clipboard_failed'

export interface DictationSnapshot {
  readonly phase: DictationPhase
  readonly elapsedMs: number
  readonly recoveryAvailable: boolean
  readonly error?: DictationErrorCategory
}

export type DictationStartOptions = Pick<TranscriptionInput, 'language' | 'modelId'>

interface RecordingEntry {
  readonly id: string
}

interface TranscriptionResult {
  readonly text: string
}

interface DictationVoiceService {
  startRecording(input: StartRecordingInput): VoiceOperation<unknown>
  createRecording(input: CreateRecordingInput): Promise<RecordingEntry>
  transcribe(input: TranscriptionInput): VoiceOperation<TranscriptionResult>
  retryTranscription(input: TranscriptionInput): VoiceOperation<TranscriptionResult>
  abortTranscription(operation: Pick<VoiceOperation<unknown>, 'sessionId' | 'requestId'>): Promise<void>
  discardSession(sessionId: string): Promise<void>
}

interface DictationTargetManager {
  captureCurrent(): CapturedVoiceTarget | null
  insert(binding: CapturedVoiceTarget, text: string): VoiceTargetInsertResult
  insertIntoCurrent(text: string, intent: 'user_recovery'): VoiceTargetInsertResult
}

interface DictationMediaRecorder {
  readonly state: RecordingState
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  start(): void
  stop(): void
}

interface DictationMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
}

interface DictationClipboard {
  writeText(text: string): Promise<void>
}

interface DictationServiceOptions {
  voice?: DictationVoiceService
  targets?: DictationTargetManager
  mediaDevices?: DictationMediaDevices
  createMediaRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => DictationMediaRecorder
  clipboard?: DictationClipboard
  now?: () => number
}

interface ActiveDictation {
  readonly generation: number
  readonly sessionId: string
  readonly target: CapturedVoiceTarget | null
  readonly options: DictationStartOptions
  readonly chunks: Blob[]
  stream?: MediaStream
  recorder?: DictationMediaRecorder
  recorderStopped?: Promise<void>
  resolveRecorderStopped?: () => void
  startedAt?: number
  fileEntryId?: string
  transcription?: VoiceOperation<TranscriptionResult>
  stopTask?: Promise<void>
  discardTask?: Promise<void>
}

const voiceReasons = new Set<string>(Object.keys(voiceErrorCodes))

function errorCategory(error: unknown, fallback: DictationErrorCategory): DictationErrorCategory {
  if (typeof error !== 'object' || error === null || !('reason' in error)) return fallback
  const reason = (error as { reason?: unknown }).reason
  return typeof reason === 'string' && voiceReasons.has(reason) ? (reason as VoiceErrorReason) : fallback
}

function isMicrophonePermissionError(error: unknown): boolean {
  return (
    error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name)
  )
}

export class DictationService {
  private readonly voice: DictationVoiceService
  private readonly targets: DictationTargetManager
  private readonly mediaDevices: DictationMediaDevices
  private readonly createMediaRecorder: (stream: MediaStream, options: MediaRecorderOptions) => DictationMediaRecorder
  private readonly clipboard: DictationClipboard
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private snapshot: DictationSnapshot = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
  private active?: ActiveDictation
  private recoveryText?: string
  private elapsedTimer?: ReturnType<typeof setInterval>
  private maximumTimer?: ReturnType<typeof setTimeout>
  private generation = 0

  constructor(options: DictationServiceOptions = {}) {
    this.voice = options.voice ?? voiceService
    this.targets = options.targets ?? voiceTargetManager
    this.mediaDevices =
      options.mediaDevices ??
      ({
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints)
      } satisfies DictationMediaDevices)
    this.createMediaRecorder =
      options.createMediaRecorder ??
      ((stream, recorderOptions) => new MediaRecorder(stream, recorderOptions) as unknown as DictationMediaRecorder)
    this.clipboard = options.clipboard ?? { writeText: (text) => navigator.clipboard.writeText(text) }
    this.now = options.now ?? (() => Date.now())
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): DictationSnapshot => this.snapshot

  async start(options: DictationStartOptions = {}): Promise<void> {
    const target = this.targets.captureCurrent()
    const generation = ++this.generation
    this.recoveryText = undefined
    if (!(await this.cleanupActive())) return
    if (generation !== this.generation) return
    this.publish('starting')

    const admission = this.voice.startRecording({ source: 'dictation' })
    const active: ActiveDictation = {
      generation,
      sessionId: admission.sessionId,
      target,
      options,
      chunks: []
    }
    this.active = active

    try {
      await admission.result
    } catch (error) {
      if (!this.isCurrent(active)) return
      this.active = undefined
      this.publish('failed', 0, false, errorCategory(error, 'operation_failed'))
      return
    }
    if (!this.isCurrent(active)) {
      await this.discardSession(active)
      return
    }

    let stream: MediaStream
    try {
      stream = await this.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      await this.cleanupSession(active)
      if (generation === this.generation) {
        this.publish(
          'failed',
          0,
          false,
          isMicrophonePermissionError(error) ? 'microphone_permission' : 'recording_failed'
        )
      }
      return
    }
    if (!this.isCurrent(active)) {
      this.stopTracks(stream)
      await this.discardSession(active)
      return
    }

    try {
      active.stream = stream
      active.recorder = this.createMediaRecorder(stream, { mimeType: RECORDING_MIME_TYPE })
      active.recorderStopped = new Promise<void>((resolve) => {
        active.resolveRecorderStopped = resolve
      })
      active.recorder.ondataavailable = ({ data }) => {
        if (data.size) active.chunks.push(data)
      }
      active.recorder.onstop = () => active.resolveRecorderStopped?.()
      active.startedAt = this.now()
      active.recorder.start()
      this.startTimers(active)
      this.publish('recording')
    } catch (error) {
      await this.cleanupSession(active)
      if (generation === this.generation) this.publish('failed', 0, false, errorCategory(error, 'recording_failed'))
    }
  }

  stop(): Promise<void> {
    const active = this.active
    if (!active) return Promise.resolve()
    if (!active.recorder) return this.cancel()
    if (!active.stopTask) active.stopTask = this.finishRecording(active)
    return active.stopTask
  }

  async cancel(): Promise<void> {
    this.generation += 1
    this.recoveryText = undefined
    const cleaned = await this.cleanupActive()
    if (cleaned) this.publish('idle')
  }

  async retry(): Promise<void> {
    const active = this.active
    if (!active?.fileEntryId || this.snapshot.phase !== 'failed') return
    await this.transcribe(active, true)
  }

  insertRecovery(): VoiceTargetInsertResult {
    if (!this.recoveryText) return 'unavailable'
    const result = this.targets.insertIntoCurrent(this.recoveryText, 'user_recovery')
    if (result === 'inserted') {
      this.recoveryText = undefined
      this.publish('idle')
    }
    return result
  }

  async copyRecovery(): Promise<boolean> {
    const text = this.recoveryText
    if (!text) return false
    try {
      await this.clipboard.writeText(text)
      if (this.recoveryText === text) {
        this.recoveryText = undefined
        this.publish('idle')
      }
      return true
    } catch {
      this.publish('recovery', 0, true, 'clipboard_failed')
      return false
    }
  }

  async discard(): Promise<void> {
    await this.cancel()
  }

  async teardown(): Promise<void> {
    await this.cancel()
    this.listeners.clear()
  }

  private async finishRecording(active: ActiveDictation): Promise<void> {
    const elapsedMs = this.elapsed(active)
    this.publish('stopping', elapsedMs)
    this.clearTimers()
    this.stopRecorder(active)
    this.stopActiveTracks(active)
    await active.recorderStopped
    if (!this.isCurrent(active)) return

    try {
      const audio = new Uint8Array(await new Blob(active.chunks, { type: RECORDING_MIME_TYPE }).arrayBuffer())
      const fileEntry = await this.voice.createRecording({ sessionId: active.sessionId, audio, durationMs: elapsedMs })
      if (!this.isCurrent(active)) return
      active.fileEntryId = fileEntry.id
      await this.transcribe(active, false)
    } catch (error) {
      if (!this.isCurrent(active)) return
      await this.cleanupSession(active)
      this.publish('failed', 0, false, errorCategory(error, 'recording_failed'))
    }
  }

  private async transcribe(active: ActiveDictation, retry: boolean): Promise<void> {
    if (!active.fileEntryId || !this.isCurrent(active)) return
    this.publish('transcribing', this.snapshot.elapsedMs)
    const input: TranscriptionInput = {
      sessionId: active.sessionId,
      fileEntryId: active.fileEntryId,
      ...active.options
    }
    const transcription = retry ? this.voice.retryTranscription(input) : this.voice.transcribe(input)
    active.transcription = transcription
    try {
      const result = await transcription.result
      if (!this.isCurrent(active)) return
      active.transcription = undefined
      await this.complete(active, result.text)
    } catch (error) {
      if (!this.isCurrent(active)) return
      active.transcription = undefined
      this.publish('failed', this.snapshot.elapsedMs, false, errorCategory(error, 'transcription_failed'))
    }
  }

  private async complete(active: ActiveDictation, text: string): Promise<void> {
    const inserted = active.target ? this.targets.insert(active.target, text) : 'unavailable'
    if (inserted === 'unavailable') this.recoveryText = text
    if (!(await this.cleanupSession(active))) return
    this.publish(this.recoveryText ? 'recovery' : 'idle', 0, Boolean(this.recoveryText))
  }

  private async cleanupActive(): Promise<boolean> {
    const active = this.active
    if (!active) {
      this.clearTimers()
      return true
    }
    return this.cleanupSession(active)
  }

  private async cleanupSession(active: ActiveDictation): Promise<boolean> {
    this.clearTimers()
    this.stopRecorder(active)
    this.stopActiveTracks(active)
    if (active.transcription) {
      await this.voice.abortTranscription(active.transcription).catch(() => undefined)
      active.transcription = undefined
    }
    try {
      await this.discardSession(active)
    } catch (error) {
      if (this.active === active) this.publish('failed', 0, false, errorCategory(error, 'operation_failed'))
      return false
    }
    if (this.active === active) this.active = undefined
    active.fileEntryId = undefined
    return true
  }

  private discardSession(active: ActiveDictation): Promise<void> {
    if (!active.discardTask) {
      active.discardTask = this.voice.discardSession(active.sessionId).catch((error: unknown) => {
        active.discardTask = undefined
        throw error
      })
    }
    return active.discardTask
  }

  private startTimers(active: ActiveDictation): void {
    this.clearTimers()
    this.elapsedTimer = setInterval(() => {
      if (this.isCurrent(active) && this.snapshot.phase === 'recording') {
        this.publish('recording', this.elapsed(active))
      }
    }, ELAPSED_UPDATE_INTERVAL_MS)
    this.maximumTimer = setTimeout(() => {
      if (this.isCurrent(active)) void this.stop()
    }, MAX_RECORDING_DURATION_MS)
  }

  private clearTimers(): void {
    if (this.elapsedTimer !== undefined) clearInterval(this.elapsedTimer)
    if (this.maximumTimer !== undefined) clearTimeout(this.maximumTimer)
    this.elapsedTimer = undefined
    this.maximumTimer = undefined
  }

  private elapsed(active: ActiveDictation): number {
    if (active.startedAt === undefined) return 0
    return Math.min(MAX_RECORDING_DURATION_MS, Math.max(0, Math.round(this.now() - active.startedAt)))
  }

  private stopRecorder(active: ActiveDictation): void {
    if (active.recorder?.state !== 'inactive') active.recorder?.stop()
    else active.resolveRecorderStopped?.()
  }

  private stopActiveTracks(active: ActiveDictation): void {
    if (!active.stream) return
    this.stopTracks(active.stream)
    active.stream = undefined
  }

  private stopTracks(stream: MediaStream): void {
    stream.getTracks().forEach((track) => track.stop())
  }

  private isCurrent(active: ActiveDictation): boolean {
    return this.active === active && active.generation === this.generation
  }

  private publish(
    phase: DictationPhase,
    elapsedMs = 0,
    recoveryAvailable = false,
    error?: DictationErrorCategory
  ): void {
    this.snapshot = Object.freeze({ phase, elapsedMs, recoveryAvailable, ...(error && { error }) })
    this.listeners.forEach((listener) => listener())
  }
}

export const dictationService = new DictationService()
