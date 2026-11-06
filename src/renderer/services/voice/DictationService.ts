import { loggerService } from '@logger'
import { preferenceService } from '@renderer/data/PreferenceService'
import type { TranscriptRevision, SpeechPcmChunk } from '@shared/ai/voice'
import { voiceErrorCodes, type VoiceErrorReason } from '@shared/ipc/errors/voice'

import { createAudioSpectrum, type AudioSpectrum } from './audioSpectrum'
import { microphoneErrorReason } from './microphoneDevices'
import { PcmCapture } from './PcmCapture'
import {
  voiceService,
  type CreateRecordingInput,
  type ResolvedTranscriptionPreferences,
  type StartRecordingInput,
  type TranscriptionInput,
  type VoiceCommandEvent,
  type VoiceOperation,
  type StreamingTranscription
} from './VoiceService'
import { voiceTargetManager, type CapturedVoiceTarget, type VoiceTargetInsertResult } from './VoiceTargetManager'

const RECORDING_MIME_TYPE = 'audio/webm;codecs=opus'
const MAX_RECORDING_DURATION_MS = 300_000
const ELAPSED_UPDATE_INTERVAL_MS = 1_000

export type DictationPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'recorded'
  | 'transcribing'
  | 'failed'
  | 'recovery'

export type DictationErrorCategory = VoiceErrorReason | 'transcription_failed' | 'clipboard_failed'

export interface DictationSnapshot {
  readonly phase: DictationPhase
  readonly elapsedMs: number
  readonly recoveryAvailable: boolean
  readonly retryAvailable?: true
  readonly error?: DictationErrorCategory
  readonly analyser?: AnalyserNode
  readonly transcript?: TranscriptRevision
}

export interface DictationRun {
  readonly result: Promise<void>
  stop(): Promise<void>
  cancel(): Promise<void>
}

interface RecordingEntry {
  readonly id: string
}

interface TranscriptionResult {
  readonly text: string
}

interface DictationVoiceService {
  initialize(): Promise<void>
  readTranscriptionPreferenceInput(): Promise<ResolvedTranscriptionPreferences>
  resolveTranscriptionPreferences(
    captured?: ResolvedTranscriptionPreferences
  ): Promise<ResolvedTranscriptionPreferences>
  subscribeCommands(listener: (event: VoiceCommandEvent) => void): () => void
  subscribeInterruptions(listener: () => void): () => void
  startRecording(input: StartRecordingInput): VoiceOperation<unknown>
  createRecording(input: CreateRecordingInput): Promise<RecordingEntry>
  startStreamingTranscription(
    input: Parameters<typeof voiceService.startStreamingTranscription>[0],
    onRevision: (update: TranscriptRevision) => void
  ): StreamingTranscription
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
  createPcmCapture?: (
    write: (chunk: SpeechPcmChunk) => Promise<void>,
    onError: (error: unknown) => void,
    onLimit: () => void
  ) => Pick<PcmCapture, 'start' | 'stop' | 'cancel'> & { readonly analyser?: AnalyserNode }
  createMediaRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => DictationMediaRecorder
  clipboard?: DictationClipboard
  readMicrophoneDeviceId?: () => Promise<string | null>
  now?: () => number
}

interface ActiveDictation {
  readonly generation: number
  readonly runToken: symbol
  readonly sessionId: string
  readonly target: CapturedVoiceTarget | null
  preferences: ResolvedTranscriptionPreferences
  readonly chunks: Blob[]
  pcm?: Pick<PcmCapture, 'start' | 'stop' | 'cancel'> & { readonly analyser?: AnalyserNode }
  streaming?: StreamingTranscription
  transcript?: TranscriptRevision
  capture?: Promise<MediaStream>
  stream?: MediaStream
  spectrum?: AudioSpectrum
  recorder?: DictationMediaRecorder
  recorderStopped?: Promise<void>
  resolveRecorderStopped?: () => void
  startedAt?: number
  fileEntryId?: string
  transcription?: VoiceOperation<TranscriptionResult>
  stopTask?: Promise<void>
  discardTask?: Promise<void>
  interrupted?: boolean
}

interface DictationRecovery {
  readonly runToken: symbol
  readonly generation: number
  readonly text: string
}

const voiceReasons = new Set<string>(Object.keys(voiceErrorCodes))

function errorCategory(error: unknown, fallback: DictationErrorCategory): DictationErrorCategory {
  if (typeof error !== 'object' || error === null || !('reason' in error)) return fallback
  const reason = (error as { reason?: unknown }).reason
  return typeof reason === 'string' && voiceReasons.has(reason) ? (reason as VoiceErrorReason) : fallback
}

export class DictationService {
  private readonly voice: DictationVoiceService
  private readonly targets: DictationTargetManager
  private readonly mediaDevices: DictationMediaDevices
  private readonly createMediaRecorder: (stream: MediaStream, options: MediaRecorderOptions) => DictationMediaRecorder
  private readonly createPcmCapture: NonNullable<DictationServiceOptions['createPcmCapture']>
  private readonly clipboard: DictationClipboard
  private readonly readMicrophoneDeviceId: () => Promise<string | null>
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private snapshot: DictationSnapshot = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
  private active?: ActiveDictation
  private recovery?: DictationRecovery
  private elapsedTimer?: ReturnType<typeof setInterval>
  private maximumTimer?: ReturnType<typeof setTimeout>
  private timerOwner?: ActiveDictation
  private initialization?: { generation: number; promise: Promise<void> }
  private unsubscribeCommands?: () => void
  private unsubscribeInterruptions?: () => void
  private lifecycleGeneration = 0
  private generation = 0
  private currentRunToken?: symbol
  private pendingStart?: symbol

  constructor(options: DictationServiceOptions = {}) {
    this.voice = options.voice ?? voiceService
    this.createPcmCapture =
      options.createPcmCapture ?? ((write, onError, onLimit) => new PcmCapture(write, onError, onLimit))
    this.readMicrophoneDeviceId =
      options.readMicrophoneDeviceId ?? (() => preferenceService.get('feature.voice.input.device_id'))
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

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization.promise
    const generation = this.lifecycleGeneration
    try {
      this.unsubscribeCommands = this.voice.subscribeCommands((event) => this.handleCommand(generation, event))
      this.unsubscribeInterruptions = this.voice.subscribeInterruptions(() => {
        if (generation === this.lifecycleGeneration && this.pendingStart) {
          void this.cancelRun(this.pendingStart)
        }
      })
    } catch (error) {
      return Promise.reject(error)
    }
    const promise = this.voice.initialize().catch((error: unknown) => {
      if (this.initialization?.generation === generation) {
        this.detachCommands()
        this.initialization = undefined
      }
      throw error
    })
    this.initialization = { generation, promise }
    return promise
  }

  start(): Promise<void> {
    return this.startScoped().result
  }

  startScoped(): DictationRun {
    const target = this.targets.captureCurrent()
    const generation = ++this.generation
    const runToken = Symbol('dictation-run')
    this.currentRunToken = runToken
    this.pendingStart = runToken
    this.recovery = undefined
    return {
      result: this.startRun(runToken, generation, target).finally(() => {
        if (this.pendingStart === runToken) this.pendingStart = undefined
      }),
      stop: () =>
        this.currentRunToken !== runToken
          ? Promise.resolve()
          : this.active?.runToken === runToken && (this.active.recorder || this.active.streaming)
            ? this.stop()
            : this.cancelRun(runToken),
      cancel: () => this.cancelRun(runToken)
    }
  }

  private async startRun(runToken: symbol, generation: number, target: CapturedVoiceTarget | null): Promise<void> {
    if (await this.cleanupActive()) return
    if (!this.isRunCurrent(runToken, generation)) return
    this.publish('starting')

    try {
      await this.initialize()
    } catch (error) {
      if (this.isRunCurrent(runToken, generation)) {
        this.publish('failed', 0, false, errorCategory(error, 'operation_failed'))
      }
      return
    }
    if (!this.isRunCurrent(runToken, generation)) return

    let deviceId: string | null = null
    let active: ActiveDictation | undefined
    try {
      const preferences = await this.voice.readTranscriptionPreferenceInput()
      deviceId = await this.readMicrophoneDeviceId()
      if (!this.isRunCurrent(runToken, generation)) return
      const admission = this.voice.startRecording({
        source: 'dictation',
        ...(target?.sourceEntityId && { sourceEntityId: target.sourceEntityId })
      })
      active = {
        generation,
        runToken,
        sessionId: admission.sessionId,
        target,
        preferences,
        chunks: []
      }
      this.active = active
      await admission.result
    } catch (error) {
      if (active && this.active === active) await this.failUnready(active, error)
      else if (this.isRunCurrent(runToken, generation)) {
        this.publish('failed', 0, false, errorCategory(error, 'operation_failed'))
      }
      return
    }
    if (!active) return
    if (this.active !== active || !this.isCurrent(active)) {
      if (this.active === active) await this.cleanupSession(active)
      return
    }

    try {
      active.preferences = await this.voice.resolveTranscriptionPreferences(active.preferences)
    } catch (error) {
      await this.failUnready(active, error)
      return
    }
    if (this.active !== active || !this.isCurrent(active)) {
      if (this.active === active) await this.cleanupSession(active)
      return
    }

    if (active.preferences.streaming) {
      await this.startStreaming(active, deviceId)
      return
    }

    let stream: MediaStream
    try {
      active.capture = this.mediaDevices.getUserMedia({
        audio: deviceId == null ? true : { deviceId: { exact: deviceId } },
        video: false
      })
      stream = await active.capture
      active.capture = undefined
    } catch (error) {
      const cleanupError = await this.cleanupSession(active)
      if (cleanupError) return
      if (this.isRunCurrent(runToken, generation)) {
        this.publish('failed', 0, false, microphoneErrorReason(error))
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
      for (const track of stream.getTracks()) {
        track.onended = () => {
          if (!this.isCurrent(active)) return
          ++this.generation
          void this.cleanupSession(active).then((cleanupError) => {
            if (!cleanupError && this.currentRunToken === runToken)
              this.publish('failed', 0, false, 'microphone_unavailable')
          })
        }
      }
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
      active.spectrum = createAudioSpectrum(stream)
      this.startTimers(active)
      this.publish('recording')
    } catch (error) {
      const cleanupError = await this.cleanupSession(active)
      if (cleanupError) return
      if (this.isRunCurrent(runToken, generation)) {
        this.publish('failed', 0, false, errorCategory(error, 'recording_failed'))
      }
    }
  }

  stop(): Promise<void> {
    const active = this.active
    if (!active) return Promise.resolve()
    if (active.streaming) {
      if (!active.stopTask) active.stopTask = this.finishStreaming(active)
      return active.stopTask
    }
    if (!active.recorder) return this.cancel()
    if (!active.stopTask) active.stopTask = this.finishRecording(active)
    return active.stopTask
  }

  async transcribeRecording(): Promise<void> {
    const active = this.active
    if (!active?.fileEntryId || this.snapshot.phase !== 'recorded') return
    await this.transcribe(active, false)
  }

  async cancel(): Promise<void> {
    const runToken = this.currentRunToken
    if (runToken) return this.cancelRun(runToken)
    this.generation += 1
    this.recovery = undefined
    const cleanupError = await this.cleanupActive()
    if (!cleanupError && !this.currentRunToken) this.publish('idle')
  }

  async retry(): Promise<void> {
    const active = this.active
    if (!active?.fileEntryId || this.snapshot.phase !== 'failed') return
    await this.transcribe(active, true)
  }

  insertRecovery(): VoiceTargetInsertResult {
    const recovery = this.recovery
    if (!recovery) return 'unavailable'
    const result = this.targets.insertIntoCurrent(recovery.text, 'user_recovery')
    if (result === 'inserted') {
      this.finishRecovery(recovery)
    }
    return result
  }

  async copyRecovery(): Promise<boolean> {
    const recovery = this.recovery
    if (!recovery) return false
    try {
      await this.clipboard.writeText(recovery.text)
      if (this.isRecoveryCurrent(recovery)) {
        this.finishRecovery(recovery)
      }
      return true
    } catch {
      if (this.isRecoveryCurrent(recovery)) this.publish('recovery', 0, true, 'clipboard_failed')
      return false
    }
  }

  async discard(): Promise<void> {
    await this.cancel()
  }

  async teardown(): Promise<void> {
    this.detachCommands()
    this.lifecycleGeneration += 1
    this.initialization = undefined
    await this.cancel()
    this.listeners.clear()
  }

  private async startStreaming(active: ActiveDictation, deviceId: string | null): Promise<void> {
    try {
      const { modelId, language } = active.preferences
      if (!modelId) throw new Error('Missing transcription model')
      const operation = this.voice.startStreamingTranscription(
        { sessionId: active.sessionId, modelId, language, format: { sampleRate: 16000, channels: 1 } },
        (update) => {
          if (!this.isCurrent(active) || update.revision <= (active.transcript?.revision ?? -1)) return
          active.transcript = update
          this.publish(this.snapshot.phase, this.elapsed(active))
        }
      )
      active.streaming = operation
      active.transcription = operation
      void operation.result.catch((error: unknown) => {
        if (this.isCurrent(active)) void this.failStreaming(active, error)
      })
      await operation.ready
      if (!this.isCurrent(active)) return
      const capture = this.createPcmCapture(
        (chunk) => operation.write(chunk),
        (error) => {
          if (this.isCurrent(active)) void this.failStreaming(active, error)
        },
        () => {
          if (this.isCurrent(active)) void this.stop()
        }
      )
      active.pcm = capture
      await capture.start(this.mediaDevices, deviceId)
      if (!this.isCurrent(active)) {
        await capture.cancel()
        return
      }
      active.startedAt = this.now()
      this.startTimers(active)
      this.publish('recording')
    } catch (error) {
      if (this.isCurrent(active)) await this.failStreaming(active, error)
    }
  }

  private async finishStreaming(active: ActiveDictation): Promise<void> {
    if (!active.pcm || !active.streaming || this.snapshot.phase !== 'recording') return this.cancel()
    this.clearTimers(active)
    this.publish('stopping', this.elapsed(active))
    try {
      const frames = await active.pcm.stop()
      if (!this.isCurrent(active)) return
      this.publish('transcribing', this.elapsed(active))
      await active.streaming.finish(frames)
      const result = await active.streaming.result
      if (!this.isCurrent(active)) return
      active.transcription = undefined
      await this.complete(active, result.text)
    } catch (error) {
      if (this.isCurrent(active)) await this.failStreaming(active, error)
    }
  }

  private async failStreaming(active: ActiveDictation, error: unknown): Promise<void> {
    if (!this.isCurrent(active)) return
    const reason = errorCategory(error, microphoneErrorReason(error))
    ++this.generation
    const cleanupError = await this.cleanupSession(active)
    if (this.currentRunToken === active.runToken) this.publish('failed', 0, false, cleanupError ?? reason)
  }

  private async finishRecording(active: ActiveDictation): Promise<void> {
    const elapsedMs = this.elapsed(active)
    this.publish('stopping', elapsedMs)
    this.clearTimers(active)
    this.stopRecorder(active)
    this.stopActiveTracks(active)
    await active.recorderStopped
    if (!this.isCurrent(active)) return

    try {
      const fileEntry = await this.createRecording(active, elapsedMs)
      if (!this.isCurrent(active)) return
      active.fileEntryId = fileEntry.id
      if (active.interrupted) this.publish('recorded', elapsedMs)
      else await this.transcribe(active, false)
    } catch (error) {
      if (!this.isCurrent(active)) return
      const cleanupError = await this.cleanupSession(active)
      if (cleanupError) return
      this.publish('failed', 0, false, errorCategory(error, 'recording_failed'))
    }
  }

  private async transcribe(active: ActiveDictation, retry: boolean): Promise<void> {
    if (!active.fileEntryId || !this.isCurrent(active)) return
    this.publish('transcribing', this.snapshot.elapsedMs)
    try {
      const preferences = retry ? await this.voice.resolveTranscriptionPreferences() : active.preferences
      if (!this.isCurrent(active)) return
      const input: TranscriptionInput = {
        sessionId: active.sessionId,
        fileEntryId: active.fileEntryId,
        modelId: preferences.modelId,
        language: preferences.language
      }
      const transcription = retry ? this.voice.retryTranscription(input) : this.voice.transcribe(input)
      active.transcription = transcription
      const result = await transcription.result
      if (!this.isCurrent(active)) return
      active.transcription = undefined
      active.fileEntryId = undefined
      await this.complete(active, result.text)
    } catch (error) {
      if (!this.isCurrent(active)) return
      active.transcription = undefined
      const category = errorCategory(error, 'transcription_failed')
      if (category === 'no_speech') {
        const cleanupError = await this.cleanupSession(active)
        if (!cleanupError && this.isRunCurrent(active.runToken, active.generation)) {
          this.publish('failed', 0, false, category)
        }
        return
      }
      this.publish('failed', this.snapshot.elapsedMs, false, category, true)
    }
  }

  private async complete(active: ActiveDictation, text: string): Promise<void> {
    let inserted: VoiceTargetInsertResult = 'unavailable'
    try {
      if (active.target) inserted = this.targets.insert(active.target, text)
    } catch {
      inserted = 'unavailable'
    }
    if (inserted === 'unavailable') {
      this.recovery = { runToken: active.runToken, generation: active.generation, text }
    }
    const cleanupError = await this.cleanupSession(active, false)
    if (!this.isRunCurrent(active.runToken, active.generation)) return
    if (this.recovery) {
      this.publish('recovery', 0, true, cleanupError)
    } else if (cleanupError) {
      this.publish('failed', 0, false, cleanupError)
    } else {
      this.currentRunToken = undefined
      this.publish('idle')
    }
  }

  private async cancelRun(runToken: symbol): Promise<void> {
    if (this.currentRunToken !== runToken) return
    this.generation += 1
    this.recovery = undefined
    const cleanupError = await this.cleanupActive()
    if (this.currentRunToken !== runToken) return
    if (!cleanupError) {
      this.currentRunToken = undefined
      this.publish('idle')
    }
  }

  private async failUnready(active: ActiveDictation, error: unknown): Promise<void> {
    if (this.active !== active) return
    const cleanupError = await this.cleanupSession(active)
    if (cleanupError || !this.isRunCurrent(active.runToken, active.generation)) return
    this.publish('failed', 0, false, errorCategory(error, 'operation_failed'))
  }

  private finishRecovery(recovery: DictationRecovery): void {
    if (!this.isRecoveryCurrent(recovery)) return
    this.recovery = undefined
    if (!this.active) this.currentRunToken = undefined
    this.publish('idle')
  }

  private isRecoveryCurrent(recovery: DictationRecovery): boolean {
    return this.recovery === recovery && this.isRunCurrent(recovery.runToken, recovery.generation)
  }

  private async cleanupActive(): Promise<DictationErrorCategory | undefined> {
    const active = this.active
    if (!active) {
      this.clearTimers()
      return undefined
    }
    return this.cleanupSession(active)
  }

  private async cleanupSession(
    active: ActiveDictation,
    publishFailure = true
  ): Promise<DictationErrorCategory | undefined> {
    this.clearTimers(active)
    this.stopRecorder(active)
    this.stopActiveTracks(active)
    const pcmCleanup = active.pcm?.cancel()
    active.pcm = undefined
    this.clearRecordingData(active)
    if (active.capture) {
      await active.capture.catch(() => undefined)
      active.capture = undefined
    }
    if (active.transcription) {
      await this.voice.abortTranscription(active.transcription).catch(() => undefined)
      active.transcription = undefined
    }
    try {
      await pcmCleanup
      await this.discardSession(active)
    } catch (error) {
      const category = errorCategory(error, 'operation_failed')
      if (publishFailure && this.active === active) this.publish('failed', 0, false, category)
      return category
    }
    if (this.active === active) this.active = undefined
    active.fileEntryId = undefined
    return undefined
  }

  private async createRecording(active: ActiveDictation, durationMs: number): Promise<RecordingEntry> {
    try {
      const blob = new Blob(active.chunks, { type: RECORDING_MIME_TYPE })
      const audio = new Uint8Array(await blob.arrayBuffer())
      return await this.voice.createRecording({ sessionId: active.sessionId, audio, durationMs })
    } finally {
      this.clearRecordingData(active)
    }
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
    this.timerOwner = active
    this.elapsedTimer = setInterval(() => {
      if (this.isCurrent(active) && this.snapshot.phase === 'recording') {
        this.publish('recording', this.elapsed(active))
      }
    }, ELAPSED_UPDATE_INTERVAL_MS)
    this.maximumTimer = setTimeout(() => {
      if (this.isCurrent(active)) void this.stop()
    }, MAX_RECORDING_DURATION_MS)
  }

  private clearTimers(active?: ActiveDictation): void {
    if (active && this.timerOwner !== active) return
    if (this.elapsedTimer !== undefined) clearInterval(this.elapsedTimer)
    if (this.maximumTimer !== undefined) clearTimeout(this.maximumTimer)
    this.elapsedTimer = undefined
    this.maximumTimer = undefined
    this.timerOwner = undefined
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
    void active.spectrum
      ?.dispose()
      .catch((error) =>
        loggerService.withContext('DictationService').warn('Could not close dictation spectrum', { error })
      )
    active.spectrum = undefined
    if (!active.stream) return
    this.stopTracks(active.stream)
    active.stream = undefined
  }

  private stopTracks(stream: MediaStream): void {
    stream.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
  }

  private clearRecordingData(active: ActiveDictation): void {
    active.chunks.length = 0
    if (active.recorder) active.recorder.ondataavailable = null
  }

  private handleCommand(generation: number, event: VoiceCommandEvent): void {
    const active = this.active
    if (generation !== this.lifecycleGeneration || !active || event.sessionId !== active.sessionId) {
      return
    }
    if (event.command === 'stop') {
      void this.cancelRun(active.runToken)
    } else if (event.command === 'interrupt') {
      if (active.streaming) {
        void this.cancelRun(active.runToken)
        return
      }
      active.interrupted = true
      if (active.fileEntryId || active.transcription) return
      void this.stop()
    }
  }

  private detachCommands(): void {
    this.unsubscribeCommands?.()
    this.unsubscribeCommands = undefined
    this.unsubscribeInterruptions?.()
    this.unsubscribeInterruptions = undefined
  }

  private isCurrent(active: ActiveDictation): boolean {
    return this.active === active && active.generation === this.generation && this.currentRunToken === active.runToken
  }

  private isRunCurrent(runToken: symbol, generation: number): boolean {
    return this.currentRunToken === runToken && this.generation === generation
  }

  private publish(
    phase: DictationPhase,
    elapsedMs = 0,
    recoveryAvailable = false,
    error?: DictationErrorCategory,
    retryAvailable?: true
  ): void {
    this.snapshot = Object.freeze({
      phase,
      elapsedMs,
      recoveryAvailable,
      ...(phase === 'recording' &&
        (this.active?.pcm || this.active?.spectrum) && {
          analyser: this.active.pcm?.analyser ?? this.active.spectrum?.analyser
        }),
      ...(['recording', 'stopping', 'transcribing'].includes(phase) &&
        this.active?.transcript && { transcript: this.active.transcript }),
      ...(retryAvailable && { retryAvailable }),
      ...(error && { error })
    })
    this.listeners.forEach((listener) => listener())
  }
}

export const dictationService = new DictationService()
