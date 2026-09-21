import type { VoiceErrorReason } from '@shared/ipc/errors/voice'
import type { VoiceSessionCommand } from '@shared/ipc/schemas/voice'

import {
  planReadableText,
  type ReadableTextMode,
  type ReadableTextPlan,
  type ReadableTextTrigger
} from './readableText'
import {
  VoiceDomainError,
  type ResolvedSpeechPreferences,
  type SpeechInput,
  type VoiceCommandEvent,
  type VoiceOperation,
  type VoiceService,
  voiceService
} from './VoiceService'

export const SPEECH_PLAYBACK_SOURCE_LABELS = ['message', 'selection', 'document', 'preview'] as const
export type SpeechPlaybackSourceLabel = (typeof SPEECH_PLAYBACK_SOURCE_LABELS)[number]
export type SpeechPlaybackPhase = 'idle' | 'generating' | 'playing' | 'paused' | 'failed'

export interface SpeechPlaybackProgress {
  readonly completed: number
  readonly total: number
}

export interface SpeechPlaybackSnapshot {
  readonly phase: SpeechPlaybackPhase
  readonly sourceLabel?: SpeechPlaybackSourceLabel
  readonly progress: SpeechPlaybackProgress
  readonly error?: VoiceErrorReason
}

export interface SpeechPlaybackStartInput {
  readonly text: string
  readonly trigger: ReadableTextTrigger
  readonly mode?: ReadableTextMode
  readonly confirmed?: boolean
  readonly sourceLabel: SpeechPlaybackSourceLabel
  readonly sourceEntityId: string
}

export type SpeechPlaybackStartResult =
  | { status: 'started' }
  | { status: 'confirmation_required'; normalizedLength: number }
  | { status: 'skipped'; reason: 'too_long'; normalizedLength: number }

type PlaybackVoiceService = Pick<
  VoiceService,
  | 'initialize'
  | 'resolveSpeechPreferences'
  | 'subscribeCommands'
  | 'generateSpeech'
  | 'abortSpeech'
  | 'readOutput'
  | 'releaseOutput'
  | 'updatePlayback'
  | 'controlPlayback'
  | 'discardSession'
>

interface SpeechPlaybackServiceOptions {
  voice?: PlaybackVoiceService
  planText?: typeof planReadableText
  ownerWindow?: Window
  createAudio?: (source: string) => HTMLAudioElement
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
}

interface PlaybackRun {
  readonly generation: number
  readonly sessionId: string
  readonly sourceLabel: SpeechPlaybackSourceLabel
  readonly trigger: ReadableTextTrigger
  readonly sourceEntityId: string
  readonly modelId: ResolvedSpeechPreferences['modelId']
  readonly voice: string
  readonly language?: string
  readonly speed?: number
  readonly chunks: readonly string[]
  index: number
  completed: number
  phase: Exclude<SpeechPlaybackPhase, 'idle'>
  desiredPaused: boolean
  mainPlaying: boolean
  materializing: boolean
  releasing: boolean
  stopped: boolean
  operation?: VoiceOperation<unknown>
  playAttempt?: Promise<void>
  retryAttempt?: Promise<void>
  fileEntryId?: string
  audio?: HTMLAudioElement
  objectUrl?: string
  ended?: EventListener
  failed?: EventListener
  cleanup?: Promise<void>
  cleanupError?: VoiceDomainError
}

const sourceLabels = new Set<string>(SPEECH_PLAYBACK_SOURCE_LABELS)
const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = Object.freeze({
  phase: 'idle',
  progress: Object.freeze({ completed: 0, total: 0 })
})

function errorReason(error: unknown): VoiceErrorReason {
  return error instanceof VoiceDomainError ? error.reason : 'operation_failed'
}

function planningResult(plan: Exclude<ReadableTextPlan, { status: 'ready' }>): SpeechPlaybackStartResult {
  if (plan.status === 'confirmation_required') {
    return { status: plan.status, normalizedLength: plan.normalizedLength }
  }
  return { status: plan.status, reason: plan.reason, normalizedLength: plan.normalizedLength }
}

export class SpeechPlaybackService {
  private readonly voice: PlaybackVoiceService
  private readonly planText: typeof planReadableText
  private readonly ownerWindow: Window
  private readonly createAudio: (source: string) => HTMLAudioElement
  private readonly createObjectURL: (blob: Blob) => string
  private readonly revokeObjectURL: (url: string) => void
  private readonly listeners = new Set<() => void>()
  private readonly runs = new Map<string, PlaybackRun>()
  private snapshot: SpeechPlaybackSnapshot = IDLE_SNAPSHOT
  private visibleRun?: PlaybackRun
  private initialization?: Promise<void>
  private unsubscribeCommands?: () => void
  private lifecycleGeneration = 0

  constructor(options: SpeechPlaybackServiceOptions = {}) {
    this.voice = options.voice ?? voiceService
    this.planText = options.planText ?? planReadableText
    this.ownerWindow = options.ownerWindow ?? window
    this.createAudio = options.createAudio ?? ((source) => new Audio(source))
    this.createObjectURL = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob))
    this.revokeObjectURL = options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url))
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SpeechPlaybackSnapshot => this.snapshot

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    const generation = this.lifecycleGeneration
    this.unsubscribeCommands = this.voice.subscribeCommands((event) => this.handleCommand(generation, event))
    this.ownerWindow.addEventListener('beforeunload', this.handleBeforeUnload)
    const initialization = this.voice.initialize().catch((error: unknown) => {
      if (generation === this.lifecycleGeneration && this.initialization === initialization) {
        this.detach()
        this.initialization = undefined
      }
      throw error
    })
    this.initialization = initialization
    return initialization
  }

  async start(input: SpeechPlaybackStartInput): Promise<SpeechPlaybackStartResult> {
    const plan = this.planText(input.text, {
      trigger: input.trigger,
      mode: input.mode,
      confirmed: input.confirmed
    })
    if (plan.status !== 'ready') return planningResult(plan)

    if (!sourceLabels.has(input.sourceLabel)) {
      this.publishStartFailure(undefined, plan.chunks.length, 'invalid_request')
      throw new VoiceDomainError('invalid_request')
    }
    if (!plan.chunks.length) {
      this.publishStartFailure(input.sourceLabel, 0, 'invalid_request')
      throw new VoiceDomainError('invalid_request')
    }

    const generation = this.lifecycleGeneration
    let preferences: ResolvedSpeechPreferences
    try {
      preferences = await this.voice.resolveSpeechPreferences()
    } catch (error) {
      const reason = errorReason(error)
      this.publishStartFailure(input.sourceLabel, plan.chunks.length, reason)
      throw new VoiceDomainError(reason)
    }
    await this.initialize()
    if (generation !== this.lifecycleGeneration) throw new VoiceDomainError('aborted')
    const deferredVisibleRun = input.trigger === 'auto_read' ? this.visibleRun : undefined
    const operation = this.voice.generateSpeech(this.speechInput(input, preferences, plan.chunks, 0))
    const run: PlaybackRun = {
      generation,
      sessionId: operation.sessionId,
      sourceLabel: input.sourceLabel,
      trigger: input.trigger,
      sourceEntityId: input.sourceEntityId,
      modelId: preferences.modelId,
      voice: preferences.voice,
      language: preferences.language,
      speed: preferences.speed,
      chunks: plan.chunks,
      index: 0,
      completed: 0,
      phase: 'generating',
      desiredPaused: false,
      mainPlaying: false,
      materializing: false,
      releasing: false,
      stopped: false,
      operation
    }
    this.runs.set(run.sessionId, run)
    if (!deferredVisibleRun) {
      this.visibleRun = run
      this.publish(run, 'generating')
    }

    try {
      await this.finishGeneration(run, operation, deferredVisibleRun)
      return { status: 'started' }
    } catch (error) {
      const reason = run.stopped || run.generation !== this.lifecycleGeneration ? 'aborted' : errorReason(error)
      if (reason === 'busy' && !run.fileEntryId) {
        this.rejectUnadmittedRun(run, reason)
        throw new VoiceDomainError(reason)
      }
      if (!run.stopped) await this.handleFailure(run, reason)
      throw new VoiceDomainError(reason)
    }
  }

  pause(sessionId?: string): Promise<void> {
    return this.control(sessionId, 'pause')
  }

  resume(sessionId?: string): Promise<void> {
    return this.control(sessionId, 'resume')
  }

  async stop(sessionId?: string): Promise<void> {
    const target = sessionId ?? this.visibleRun?.sessionId
    if (!target) throw new VoiceDomainError('invalid_request')
    const run = this.runs.get(target)
    const retryingCleanup = run?.stopped === true
    if (!retryingCleanup) await this.control(target, 'stop')
    if (!run || this.runs.get(target) !== run) return
    if (run.cleanup) return run.cleanup
    if (!retryingCleanup && run.cleanupError) throw run.cleanupError
    await this.terminate(run, true)
  }

  async stopAutoRead(): Promise<boolean> {
    const run = this.visibleRun
    if (!run || run.trigger !== 'auto_read') return false
    await this.stop(run.sessionId)
    return true
  }

  async control(sessionId: string | undefined, command: VoiceSessionCommand): Promise<void> {
    const target = sessionId ?? this.visibleRun?.sessionId
    if (!target) throw new VoiceDomainError('invalid_request')
    await this.voice.controlPlayback({ sessionId: target, command })
  }

  retry(sessionId?: string): Promise<void> {
    const run = this.resolveRun(sessionId)
    if (!run || run.phase !== 'failed' || !run.audio || !run.fileEntryId || !run.objectUrl) {
      return Promise.reject(new VoiceDomainError('invalid_request'))
    }
    if (run.retryAttempt) return run.retryAttempt
    const retryAttempt = this.retryRun(run).finally(() => {
      if (run.retryAttempt === retryAttempt) run.retryAttempt = undefined
    })
    run.retryAttempt = retryAttempt
    return retryAttempt
  }

  private async retryRun(run: PlaybackRun): Promise<void> {
    try {
      await this.playAudio(run, true)
    } catch (error) {
      await this.failAudio(run, errorReason(error))
      throw new VoiceDomainError(errorReason(error))
    }
  }

  async teardown(): Promise<void> {
    this.detach()
    this.lifecycleGeneration += 1
    this.initialization = undefined
    const runs = [...this.runs.values()]
    const results = await Promise.allSettled(runs.map((run) => this.terminate(run, false)))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw new VoiceDomainError(errorReason(failure.reason))
    this.listeners.clear()
    this.visibleRun = undefined
    this.setSnapshot(IDLE_SNAPSHOT)
  }

  private speechInput(
    input: SpeechPlaybackStartInput,
    preferences: ResolvedSpeechPreferences,
    chunks: readonly string[],
    index: number,
    sessionId?: string
  ): SpeechInput {
    return {
      ...(sessionId && { sessionId }),
      modelId: preferences.modelId,
      text: chunks[index],
      voice: preferences.voice,
      ...(preferences.language && { language: preferences.language }),
      speed: preferences.speed,
      source: 'playback',
      sourceEntityId: input.sourceEntityId,
      trigger: input.trigger,
      chunkIndex: index,
      chunkCount: chunks.length
    }
  }

  private async finishGeneration(
    run: PlaybackRun,
    operation: VoiceOperation<unknown>,
    claimVisibilityFrom?: PlaybackRun
  ): Promise<void> {
    run.materializing = true
    try {
      const result = (await operation.result) as Awaited<ReturnType<PlaybackVoiceService['generateSpeech']>['result']>
      this.assertCurrent(run)
      if (claimVisibilityFrom) {
        if (this.visibleRun !== claimVisibilityFrom) throw new VoiceDomainError('aborted')
        this.visibleRun = run
        this.publish(run, 'generating')
      }
      if (run.operation === operation) run.operation = undefined
      run.fileEntryId = result.fileEntry.id
      const output = await this.voice.readOutput({ sessionId: run.sessionId, fileEntryId: result.fileEntry.id })
      this.assertCurrent(run)
      if (output.mimeType !== 'audio/wav') throw new VoiceDomainError('invalid_audio')

      const objectUrl = this.createObjectURL(new Blob([output.audio], { type: output.mimeType }))
      const audio = this.createAudio(objectUrl)
      run.objectUrl = objectUrl
      run.audio = audio
      run.ended = () => void this.handleEnded(run, audio)
      run.failed = () => void this.handleAudioError(run, audio)
      audio.addEventListener('ended', run.ended)
      audio.addEventListener('error', run.failed)
      if (run.desiredPaused) {
        run.phase = 'paused'
        this.publish(run, 'paused')
        return
      }
      await this.playAudio(run, true)
    } finally {
      run.materializing = false
    }
  }

  private async generateNext(run: PlaybackRun): Promise<void> {
    if (run.stopped || run.desiredPaused || run.materializing || run.releasing || run.index >= run.chunks.length) return
    run.phase = 'generating'
    run.mainPlaying = false
    this.publish(run, 'generating')
    const operation = this.voice.generateSpeech({
      sessionId: run.sessionId,
      modelId: run.modelId,
      text: run.chunks[run.index],
      voice: run.voice,
      ...(run.language && { language: run.language }),
      ...(run.speed !== undefined && { speed: run.speed }),
      source: 'playback',
      sourceEntityId: run.sourceEntityId,
      trigger: run.trigger,
      chunkIndex: run.index,
      chunkCount: run.chunks.length
    })
    run.operation = operation
    try {
      await this.finishGeneration(run, operation)
    } catch (error) {
      if (!run.stopped) await this.handleFailure(run, errorReason(error))
    }
  }

  private playAudio(run: PlaybackRun, reportPlaying: boolean): Promise<void> {
    if (run.playAttempt) return run.playAttempt
    const playAttempt = this.performPlay(run, reportPlaying).finally(() => {
      if (run.playAttempt === playAttempt) run.playAttempt = undefined
    })
    run.playAttempt = playAttempt
    return playAttempt
  }

  private async performPlay(run: PlaybackRun, reportPlaying: boolean): Promise<void> {
    const audio = run.audio
    if (!audio) throw new VoiceDomainError('invalid_audio')
    await audio.play()
    this.assertCurrent(run, audio)
    if (run.desiredPaused) {
      audio.pause()
      run.phase = 'paused'
      this.publish(run, 'paused')
      return
    }
    if (reportPlaying && !run.mainPlaying) {
      await this.voice.updatePlayback({ sessionId: run.sessionId, phase: 'playing' })
    }
    this.assertCurrent(run, audio)
    if (run.desiredPaused) {
      audio.pause()
      run.phase = 'paused'
      this.publish(run, 'paused')
      return
    }
    run.mainPlaying = true
    run.phase = 'playing'
    this.publish(run, 'playing')
  }

  private async handleEnded(run: PlaybackRun, audio: HTMLAudioElement): Promise<void> {
    if (run.stopped || run.phase !== 'playing' || run.audio !== audio || run.releasing || !run.fileEntryId) return
    run.releasing = true
    const fileEntryId = run.fileEntryId
    try {
      await this.voice.releaseOutput({ sessionId: run.sessionId, fileEntryId })
      this.assertCurrent(run, audio)
      this.disposeAudio(run, true)
      run.fileEntryId = undefined
      run.completed += 1
      run.index += 1
      run.releasing = false
      if (run.index >= run.chunks.length) {
        await this.completeReleasedRun(run)
      } else if (!run.desiredPaused) {
        await this.generateNext(run)
      } else {
        run.phase = 'paused'
        this.publish(run, 'paused')
      }
    } catch (error) {
      if (!run.stopped) await this.failAudio(run, errorReason(error))
    } finally {
      run.releasing = false
    }
  }

  private async completeReleasedRun(run: PlaybackRun): Promise<void> {
    try {
      await this.voice.updatePlayback({ sessionId: run.sessionId, phase: 'completed' })
      this.assertCurrent(run)
      this.releaseRun(run, true)
    } catch (error) {
      const reason = errorReason(error)
      const wasVisible = this.visibleRun === run
      try {
        await this.terminate(run, false)
      } catch {
        return
      }
      if (wasVisible && !this.visibleRun) this.publishFailure(run.sourceLabel, run.chunks.length, reason)
    }
  }

  private async handleAudioError(run: PlaybackRun, audio: HTMLAudioElement): Promise<void> {
    if (run.stopped || run.audio !== audio) return
    await this.failAudio(run, 'operation_failed')
  }

  private async failAudio(run: PlaybackRun, reason: VoiceErrorReason): Promise<void> {
    if (run.stopped) return
    run.audio?.pause()
    run.phase = 'failed'
    try {
      await this.voice.updatePlayback({ sessionId: run.sessionId, phase: 'failed', reason })
    } catch {
      // The stable Renderer state still reports the local playback failure.
    }
    if (run.stopped || this.runs.get(run.sessionId) !== run) return
    run.mainPlaying = false
    this.publish(run, 'failed', reason)
  }

  private async handleFailure(run: PlaybackRun, reason: VoiceErrorReason): Promise<void> {
    if (run.audio && run.fileEntryId && run.objectUrl) {
      await this.failAudio(run, reason)
      return
    }
    const wasVisible = this.visibleRun === run
    await this.terminate(run, false)
    if (wasVisible && !this.visibleRun) this.publishFailure(run.sourceLabel, run.chunks.length, reason)
  }

  private handleCommand(generation: number, event: VoiceCommandEvent): void {
    if (generation !== this.lifecycleGeneration) return
    const run = this.runs.get(event.sessionId)
    if (!run || (run.stopped && event.command !== 'stop')) return
    switch (event.command) {
      case 'pause':
        run.desiredPaused = true
        run.mainPlaying = false
        run.audio?.pause()
        run.phase = 'paused'
        this.publish(run, 'paused')
        break
      case 'resume':
        run.desiredPaused = false
        run.mainPlaying = true
        if (run.releasing || run.materializing) return
        if (run.audio) {
          void this.playAudio(run, false).catch((error: unknown) => this.failAudio(run, errorReason(error)))
        } else {
          void this.generateNext(run)
        }
        break
      case 'stop':
        void this.terminate(run, true).catch(() => undefined)
        break
    }
  }

  private terminate(run: PlaybackRun, publishIdle: boolean): Promise<void> {
    if (run.cleanup) return run.cleanup
    run.stopped = true
    run.cleanupError = undefined
    this.disposeAudio(run, true)
    const cleanup = (async () => {
      const tasks = [this.voice.discardSession(run.sessionId)]
      if (run.operation) tasks.unshift(this.voice.abortSpeech(run.operation))
      const results = await Promise.allSettled(tasks)
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw new VoiceDomainError(errorReason(failure.reason))
      run.operation = undefined
      this.releaseRun(run, publishIdle)
    })()
      .catch((error: unknown) => {
        const reason = errorReason(error)
        run.cleanupError = new VoiceDomainError(reason)
        run.phase = 'failed'
        this.publish(run, 'failed', reason)
        throw run.cleanupError
      })
      .finally(() => {
        if (run.cleanup === cleanup) run.cleanup = undefined
      })
    run.cleanup = cleanup
    return cleanup
  }

  private releaseRun(run: PlaybackRun, publishIdle: boolean): void {
    this.runs.delete(run.sessionId)
    if (this.visibleRun !== run) return
    this.visibleRun = undefined
    if (publishIdle) this.setSnapshot(IDLE_SNAPSHOT)
  }

  private rejectUnadmittedRun(run: PlaybackRun, reason: VoiceErrorReason): void {
    if (this.runs.get(run.sessionId) === run) this.runs.delete(run.sessionId)
    if (this.visibleRun !== run) return
    this.visibleRun = undefined
    this.publishFailure(run.sourceLabel, run.chunks.length, reason)
  }

  private disposeAudio(run: PlaybackRun, revoke: boolean): void {
    const audio = run.audio
    if (audio) {
      audio.pause()
      if (run.ended) audio.removeEventListener('ended', run.ended)
      if (run.failed) audio.removeEventListener('error', run.failed)
    }
    if (revoke && run.objectUrl) this.revokeObjectURL(run.objectUrl)
    run.audio = undefined
    run.objectUrl = undefined
    run.ended = undefined
    run.failed = undefined
  }

  private resolveRun(sessionId?: string): PlaybackRun | undefined {
    if (sessionId) return this.runs.get(sessionId)
    return this.visibleRun
  }

  private assertCurrent(run: PlaybackRun, audio?: HTMLAudioElement): void {
    if (
      run.stopped ||
      run.generation !== this.lifecycleGeneration ||
      this.runs.get(run.sessionId) !== run ||
      (audio && run.audio !== audio)
    ) {
      throw new VoiceDomainError('aborted')
    }
  }

  private publish(run: PlaybackRun, phase: Exclude<SpeechPlaybackPhase, 'idle'>, error?: VoiceErrorReason): void {
    if (this.visibleRun !== run) return
    this.setSnapshot({
      phase,
      sourceLabel: run.sourceLabel,
      progress: { completed: run.completed, total: run.chunks.length },
      ...(error && { error })
    })
  }

  private publishFailure(
    sourceLabel: SpeechPlaybackSourceLabel | undefined,
    total: number,
    error: VoiceErrorReason
  ): void {
    this.setSnapshot({
      phase: 'failed',
      ...(sourceLabel && { sourceLabel }),
      progress: { completed: 0, total },
      error
    })
  }

  private publishStartFailure(
    sourceLabel: SpeechPlaybackSourceLabel | undefined,
    total: number,
    error: VoiceErrorReason
  ): void {
    if (!this.visibleRun) this.publishFailure(sourceLabel, total, error)
  }

  private setSnapshot(snapshot: SpeechPlaybackSnapshot): void {
    this.snapshot = snapshot
    this.listeners.forEach((listener) => listener())
  }

  private detach(): void {
    this.unsubscribeCommands?.()
    this.unsubscribeCommands = undefined
    this.ownerWindow.removeEventListener('beforeunload', this.handleBeforeUnload)
  }

  private readonly handleBeforeUnload = (): void => {
    void this.teardown().catch(() => undefined)
  }
}

export const speechPlaybackService = new SpeechPlaybackService()
