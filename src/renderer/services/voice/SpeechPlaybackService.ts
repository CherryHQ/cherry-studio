import { loggerService } from '@logger'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'
import type { VoicePlaybackState } from '@shared/ipc/schemas/voice'
import type { InputFor } from '@shared/ipc/types'
import type { OutputFor } from '@shared/ipc/types'

import { FinitePlayback } from './FinitePlayback'
import { PcmPlayback } from './PcmPlayback'
import {
  planReadableText,
  type ReadableTextMode,
  type ReadableTextPlan,
  type ReadableTextTrigger
} from './readableText'
import type { SpeechPlayback } from './speechPlaybackTypes'
import type { SpeechTextInput } from './SpeechTextInput'
import {
  VoiceDomainError,
  type SpeechPreferenceInput,
  type SpeechInput,
  type VoiceCommandEvent,
  type VoiceOperation,
  type VoiceService,
  voiceService
} from './VoiceService'

export const SPEECH_PLAYBACK_SOURCE_LABELS = ['message', 'selection', 'document', 'preview'] as const
export type SpeechPlaybackSourceLabel = (typeof SPEECH_PLAYBACK_SOURCE_LABELS)[number]
export type SpeechPlaybackPhase = 'idle' | 'generating' | 'ready' | 'playing' | 'paused' | 'failed'

export interface SpeechPlaybackProgress {
  readonly completed: number
  readonly total: number
}

export interface SpeechPlaybackSnapshot {
  readonly phase: SpeechPlaybackPhase
  readonly sourceLabel?: SpeechPlaybackSourceLabel
  readonly progress: SpeechPlaybackProgress
  readonly error?: VoiceErrorReason
  readonly analyser?: AnalyserNode
}

export interface SpeechPlaybackStartInput {
  readonly text: string
  readonly trigger: ReadableTextTrigger
  readonly mode?: ReadableTextMode
  readonly confirmed?: boolean
  readonly sourceLabel: SpeechPlaybackSourceLabel
  readonly sourceEntityId: string
  readonly signal?: AbortSignal
  readonly textInput?: SpeechTextInput
}

export type SpeechPlaybackStartResult =
  | { status: 'started' }
  | { status: 'confirmation_required'; normalizedLength: number }
  | { status: 'skipped'; reason: 'too_long'; normalizedLength: number }

type PlaybackVoiceService = Pick<
  VoiceService,
  | 'subscribeStream'
  | 'attachStream'
  | 'acknowledgeStream'
  | 'initialize'
  | 'readSpeechPreferenceInput'
  | 'subscribeCommands'
  | 'subscribeInterruptions'
  | 'generateSpeech'
  | 'writeSpeechText'
  | 'finishSpeechText'
  | 'abortSpeech'
  | 'releaseOutput'
  | 'reportPlayback'
  | 'subscribe'
  | 'getSnapshot'
  | 'controlPlayback'
  | 'discardSession'
>

interface SpeechPlaybackServiceOptions {
  voice?: PlaybackVoiceService
  planText?: typeof planReadableText
  ownerWindow?: Window
  createAudio?: (source: string) => HTMLAudioElement
}

interface PlaybackRun {
  readonly generation: number
  readonly sessionId: string
  readonly sourceLabel: SpeechPlaybackSourceLabel
  readonly trigger: ReadableTextTrigger
  readonly sourceEntityId: string
  modelId?: SpeechPreferenceInput['modelId']
  voice: string
  language?: string
  speed?: number
  readonly chunks: readonly string[]
  index: number
  completed: number
  target?: VoicePlaybackState
  interrupted: boolean
  failedAttempt?: number
  audioAttemptId?: number
  releasing: boolean
  stopped: boolean
  operation?: VoiceOperation<unknown>
  audioFailureRevision: number
  playAttempt?: Promise<void>
  preparing?: Promise<void>
  playCommandRevision?: number
  outputId?: string
  output?: OutputFor<'ai.speech.generate'>['output']
  requestId?: string
  audio?: SpeechPlayback
  audioCleanup?: Promise<void>
  ended?: EventListener
  failed?: EventListener
  cleanup?: Promise<void>
  cleanupError?: VoiceDomainError
  detachAbort?: () => void
  pendingEnded?: SpeechPlayback
  textInput?: SpeechTextInput
  inputTask?: Promise<void>
}

const logger = loggerService.withContext('SpeechPlaybackService')
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
  private readonly listeners = new Set<() => void>()
  private readonly runs = new Map<string, PlaybackRun>()
  private snapshot: SpeechPlaybackSnapshot = IDLE_SNAPSHOT
  private visibleRun?: PlaybackRun
  // Completion can clear visibility without superseding a pending admission.
  private visibilityToken = Symbol()
  private initialization?: Promise<void>
  private unsubscribeState?: () => void
  private unsubscribeCommands?: () => void
  private unsubscribeInterruptions?: () => void
  private lifecycleGeneration = 0
  private interruptionGeneration = 0
  private autoReadGeneration = 0

  constructor(options: SpeechPlaybackServiceOptions = {}) {
    this.voice = options.voice ?? voiceService
    this.planText = options.planText ?? planReadableText
    this.ownerWindow = options.ownerWindow ?? window
    this.createAudio =
      options.createAudio ??
      ((source) => {
        const audio = new Audio()
        audio.crossOrigin = 'anonymous'
        audio.src = source
        return audio
      })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SpeechPlaybackSnapshot => this.snapshot

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    const generation = this.lifecycleGeneration
    this.unsubscribeState = this.voice.subscribe(() => {
      const state = this.voice.getSnapshot()
      if (state.phase !== 'idle' && state.playback?.failure) {
        const run = this.runs.get(state.sessionId)
        if (run?.output?.kind === 'pcm-stream') void this.disposeAudio(run).catch(() => undefined)
      }
      if (this.visibleRun) this.publish(this.visibleRun)
    })
    this.unsubscribeCommands = this.voice.subscribeCommands((event) => this.handleCommand(generation, event))
    this.unsubscribeInterruptions = this.voice.subscribeInterruptions(() => {
      if (generation !== this.lifecycleGeneration) return
      this.interruptionGeneration += 1
      this.runs.forEach((run) => {
        if (!run.stopped) {
          run.interrupted = true
          void run.audio?.pause().catch(() => undefined)
        }
      })
    })
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
    if (input.signal?.aborted) throw new VoiceDomainError('aborted')
    const plan = this.planText(input.text, {
      trigger: input.trigger,
      mode: input.textInput ? 'selection' : input.mode,
      confirmed: input.confirmed
    })
    if (plan.status !== 'ready') return planningResult(plan)
    if (input.textInput) plan.chunks = [input.text]

    if (!sourceLabels.has(input.sourceLabel)) {
      this.publishStartFailure(undefined, plan.chunks.length, 'invalid_request')
      throw new VoiceDomainError('invalid_request')
    }
    if (!plan.chunks.length) {
      this.publishStartFailure(input.sourceLabel, 0, 'invalid_request')
      throw new VoiceDomainError('invalid_request')
    }

    const generation = this.lifecycleGeneration
    const interruptionGeneration = this.interruptionGeneration
    const autoReadGeneration = this.autoReadGeneration
    let startedRun: PlaybackRun | undefined = undefined
    const abort = (): void => {
      if (startedRun) void this.terminate(startedRun, true).catch(() => undefined)
    }
    const detachAbort = (): void => input.signal?.removeEventListener('abort', abort)
    input.signal?.addEventListener('abort', abort, { once: true })
    const assertStartCurrent = (): void => {
      if (
        input.signal?.aborted ||
        generation !== this.lifecycleGeneration ||
        interruptionGeneration !== this.interruptionGeneration ||
        (input.trigger === 'auto_read' && autoReadGeneration !== this.autoReadGeneration)
      ) {
        throw new VoiceDomainError('aborted')
      }
    }
    let preferences: SpeechPreferenceInput
    try {
      await this.initialize()
      assertStartCurrent()
      preferences = await this.voice.readSpeechPreferenceInput()
      assertStartCurrent()
    } catch (error) {
      detachAbort()
      assertStartCurrent()
      const reason = errorReason(error)
      this.publishStartFailure(input.sourceLabel, plan.chunks.length, reason)
      throw new VoiceDomainError(reason)
    }
    const deferredVisibilityToken = input.trigger === 'auto_read' && this.visibleRun ? this.visibilityToken : undefined
    const operation = this.voice.generateSpeech(this.speechInput(input, preferences, plan.chunks, 0))
    const run: PlaybackRun = {
      generation,
      sessionId: operation.sessionId,
      sourceLabel: input.sourceLabel,
      trigger: input.trigger,
      sourceEntityId: input.sourceEntityId,
      modelId: preferences.modelId,
      voice: preferences.voice ?? '',
      language: preferences.language,
      speed: preferences.speed,
      chunks: plan.chunks,
      index: 0,
      completed: 0,
      interrupted: false,
      releasing: false,
      stopped: false,
      audioFailureRevision: 0,
      operation,
      detachAbort,
      textInput: input.textInput
    }
    startedRun = run
    this.runs.set(run.sessionId, run)
    if (deferredVisibilityToken === undefined) {
      this.visibilityToken = Symbol()
      this.visibleRun = run
      this.publish(run)
    }

    await this.finishGeneration(run, operation, deferredVisibilityToken)
    if (run.textInput) {
      const textInput = run.textInput
      run.inputTask = (async () => {
        let sequence = 0
        for await (const event of textInput) {
          this.assertCurrent(run)
          await this.voice.writeSpeechText({
            sessionId: run.sessionId,
            requestId: operation.requestId,
            sequence,
            event
          })
          sequence++
        }
        this.assertCurrent(run)
        await this.voice.finishSpeechText({ sessionId: run.sessionId, requestId: operation.requestId, sequence })
      })().catch((error: unknown) => {
        textInput.cancel()
        if (!run.stopped) void this.failPlayback(run, errorReason(error)).catch(() => undefined)
      })
    }
    return { status: 'started' }
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
    this.autoReadGeneration += 1
    const runs = [...this.runs.values()].filter((run) => run.trigger === 'auto_read')
    await Promise.all(runs.map((run) => this.terminate(run, true)))
    return runs.length > 0
  }

  async control(
    sessionId: string | undefined,
    command: InputFor<'ai.voice.playback.control'>['command']
  ): Promise<void> {
    const target = sessionId ?? this.visibleRun?.sessionId
    if (!target) throw new VoiceDomainError('invalid_request')
    await this.voice.controlPlayback({ sessionId: target, command })
  }

  canRetry(sessionId: string): boolean {
    const state = this.voice.getSnapshot()
    return (
      state.phase !== 'idle' &&
      state.sessionId === sessionId &&
      Boolean(state.playback?.availableCommands.includes('retry'))
    )
  }

  retry(sessionId?: string): Promise<void> {
    return this.control(sessionId, 'retry')
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
    preferences: SpeechPreferenceInput,
    chunks: readonly string[],
    index: number,
    sessionId?: string
  ): SpeechInput {
    return {
      ...(sessionId && { sessionId }),
      ...(preferences.modelId && { modelId: preferences.modelId }),
      text: chunks[index],
      preferStream: true,
      ...(input.textInput ? { textStream: true as const } : { remainingText: chunks.slice(index + 1) }),
      ...(preferences.voice && { voice: preferences.voice }),
      ...(preferences.language && { language: preferences.language }),
      speed: preferences.speed,
      source: 'playback',
      sourceEntityId: input.sourceEntityId,
      trigger: input.trigger,
      chunkIndex: index,
      chunkCount: chunks.length,
      ...(!sessionId && index === 0 && { preferenceResolution: true as const })
    }
  }

  private async finishGeneration(
    run: PlaybackRun,
    operation: VoiceOperation<unknown>,
    claimVisibilityWith?: symbol
  ): Promise<void> {
    try {
      const result = (await operation.result) as Awaited<ReturnType<PlaybackVoiceService['generateSpeech']>['result']>
      if (run.operation === operation) run.operation = undefined
      this.assertCurrent(run)
      if (claimVisibilityWith !== undefined) {
        if (this.visibilityToken !== claimVisibilityWith) {
          await this.terminate(run, false)
          throw new VoiceDomainError('aborted')
        }
        this.visibilityToken = Symbol()
        this.visibleRun = run
        this.publish(run)
      }
      if (result.resolved) {
        run.modelId = result.resolved.modelId
        run.voice = result.resolved.voice
        run.language = result.resolved.language
        run.speed = result.resolved.speed
      }
      run.outputId = result.output.id
      run.output = result.output
      run.requestId = result.requestId
      this.acceptTarget(run, result.playback)
      await this.executeTarget(run)
    } catch (error) {
      const reason = run.stopped || run.generation !== this.lifecycleGeneration ? 'aborted' : errorReason(error)
      const ownsGeneration = run.operation === operation
      if (ownsGeneration) run.operation = undefined
      if (!run.stopped && reason === 'aborted' && ownsGeneration) {
        await this.terminate(run, true)
      } else if (!run.stopped && reason !== 'aborted') {
        await this.handleFailure(run, reason)
      }
      throw new VoiceDomainError(reason)
    } finally {
      this.flushEnded(run)
    }
  }

  private async generateNext(run: PlaybackRun): Promise<void> {
    if (run.stopped || this.isPaused(run) || run.operation || run.releasing || run.index >= run.chunks.length) return
    this.publish(run)
    const operation = this.voice.generateSpeech({
      sessionId: run.sessionId,
      ...(run.modelId && { modelId: run.modelId }),
      text: run.chunks[run.index],
      ...(run.voice && { voice: run.voice }),
      ...(run.language && { language: run.language }),
      ...(run.speed !== undefined && { speed: run.speed }),
      source: 'playback',
      sourceEntityId: run.sourceEntityId,
      trigger: run.trigger,
      chunkIndex: run.index,
      chunkCount: run.chunks.length
    })
    run.operation = operation
    await this.finishGeneration(run, operation).catch(() => undefined)
  }

  private acceptTarget(run: PlaybackRun, target: VoicePlaybackState): void {
    if (run.target && (target.commandRevision < run.target.commandRevision || target.attemptId < run.target.attemptId))
      return
    run.target = target
    run.interrupted = false
  }

  private isPaused(run: PlaybackRun): boolean {
    return run.interrupted || run.target?.desired === 'paused'
  }

  private async executeTarget(run: PlaybackRun): Promise<void> {
    const target = run.target
    if (!target || run.stopped) return
    if (target.desired === 'stopped') {
      await this.terminate(run, true)
      return
    }
    if (run.releasing) return
    if (target.pendingCommand === 'retry' && run.output?.kind === 'pcm-stream') {
      await this.disposeAudio(run)
      if (run.stopped || run.operation) return
      run.output = undefined
      run.outputId = undefined
      run.index = 0
      run.completed = 0
      const operation = this.voice.generateSpeech({
        ...this.speechInput(
          { text: '', trigger: run.trigger, sourceLabel: run.sourceLabel, sourceEntityId: run.sourceEntityId },
          { modelId: run.modelId, voice: run.voice, language: run.language, speed: run.speed ?? 1 },
          run.chunks,
          0,
          run.sessionId
        ),
        retryAttemptId: target.attemptId
      })
      run.operation = operation
      await this.finishGeneration(run, operation)
      return
    }
    if (run.output && run.audioAttemptId !== target.attemptId) await this.preparePlayback(run)
    if (run.stopped) return
    if (this.isPaused(run)) {
      await run.audio?.pause()
      await this.report(run, 'paused')
    } else if (run.audio) {
      await this.playAudio(run)
    } else if (!run.operation) {
      await this.generateNext(run)
    }
  }

  private preparePlayback(run: PlaybackRun): Promise<void> {
    if (run.preparing) return run.preparing.then(() => this.preparePlayback(run))
    const target = run.target!
    const preparing = (async () => {
      if (run.output && run.audioAttemptId !== target.attemptId) {
        await this.disposeAudio(run)
        if (run.stopped) return
        run.playAttempt = undefined
        run.failedAttempt = undefined
        let audio: SpeechPlayback
        switch (run.output.kind) {
          case 'audio':
            audio = new FinitePlayback(this.createAudio(run.output.url))
            break
          case 'pcm-stream':
            audio = new PcmPlayback(
              { sessionId: run.sessionId, requestId: run.requestId!, attemptId: target.attemptId },
              run.output,
              run.output.capacityFrames,
              {
                subscribe: this.voice.subscribeStream.bind(this.voice),
                attach: this.voice.attachStream.bind(this.voice),
                acknowledge: this.voice.acknowledgeStream.bind(this.voice)
              }
            )
            break
        }
        run.audio = audio
        run.audioAttemptId = target.attemptId
        run.ended = () => void this.handleEnded(run, audio)
        run.failed = () => void this.failPlayback(run, 'operation_failed', audio)
        audio.addEventListener('ended', run.ended)
        audio.addEventListener('error', run.failed)
      }
    })().finally(() => {
      if (run.preparing === preparing) run.preparing = undefined
    })
    run.preparing = preparing
    return preparing
  }

  private report(
    run: PlaybackRun,
    phase: InputFor<'ai.voice.playback.report'>['phase'],
    reason?: VoiceErrorReason,
    target = run.target!
  ) {
    return this.voice.reportPlayback({
      sessionId: run.sessionId,
      attemptId: target.attemptId,
      commandRevision: target.commandRevision,
      phase,
      ...(reason && { reason })
    })
  }

  private playAudio(run: PlaybackRun): Promise<void> {
    const target = run.target!
    if (run.playAttempt && run.playCommandRevision === target.commandRevision) return run.playAttempt
    const failureRevision = run.audioFailureRevision
    const audio = run.audio
    const playAttempt = Promise.resolve()
      .then(() => this.performPlay(run, audio, target, failureRevision))
      .finally(() => {
        if (run.playAttempt === playAttempt) run.playAttempt = undefined
        this.flushEnded(run)
      })
    run.playAttempt = playAttempt
    run.playCommandRevision = target.commandRevision
    return playAttempt
  }

  private async performPlay(
    run: PlaybackRun,
    audio: SpeechPlayback | undefined,
    target: VoicePlaybackState,
    failureRevision: number
  ): Promise<void> {
    const assertPlayable = () => {
      this.assertCurrent(run, audio)
      if (run.audioFailureRevision !== failureRevision) throw new VoiceDomainError('operation_failed')
    }
    if (!audio) throw new VoiceDomainError('invalid_audio')
    assertPlayable()
    if (this.isPaused(run)) return
    try {
      await audio.play()
    } catch (error) {
      assertPlayable()
      if (
        error instanceof DOMException &&
        error.name === 'AbortError' &&
        (this.isPaused(run) || target.commandRevision !== run.target?.commandRevision)
      )
        return
      throw error
    }
    assertPlayable()
    if (this.isPaused(run)) {
      await audio.pause()
      return
    }
    await this.report(run, 'playing', undefined, target)
    assertPlayable()
  }

  private flushEnded(run: PlaybackRun): void {
    if (run.playAttempt || run.operation || !run.pendingEnded) return
    const audio = run.pendingEnded
    run.pendingEnded = undefined
    void this.handleEnded(run, audio)
  }

  private async handleEnded(run: PlaybackRun, audio: SpeechPlayback): Promise<void> {
    if (run.stopped || run.audio !== audio || run.releasing || !run.outputId) return
    if (run.playAttempt || run.operation) {
      run.pendingEnded = audio
      return
    }
    if (run.failedAttempt === run.audioAttemptId) return
    run.releasing = true
    const outputId = run.outputId
    try {
      await this.disposeAudio(run)
      try {
        await this.report(run, 'ended')
        if (run.output?.kind === 'audio') await this.voice.releaseOutput({ sessionId: run.sessionId, outputId })
        this.assertCurrent(run)
        run.outputId = undefined
        const count = run.output?.kind === 'pcm-stream' ? run.chunks.length : 1
        run.output = undefined
        run.completed += count
        run.index += count
      } finally {
        run.releasing = false
      }
      if (run.index >= run.chunks.length) {
        await this.completeReleasedRun(run)
      } else {
        await this.executeTarget(run)
      }
    } catch (error) {
      if (!run.stopped) await this.handleFailure(run, errorReason(error))
    }
  }

  private async completeReleasedRun(run: PlaybackRun): Promise<void> {
    try {
      const state = await this.report(run, 'completed')
      this.assertCurrent(run)
      if (state.phase !== 'idle' && state.sessionId === run.sessionId) {
        // Ignored completion reports retain Main ownership; cleanup failures must remain retryable.
        await this.terminate(run, true).catch(() => undefined)
        return
      }
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

  private async failPlayback(run: PlaybackRun, reason: VoiceErrorReason, audio = run.audio): Promise<void> {
    if (run.stopped || run.audio !== audio || run.failedAttempt === run.target?.attemptId) return
    const attemptId = run.target?.attemptId
    run.failedAttempt = attemptId
    run.audioFailureRevision += 1
    await audio?.pause().catch(() => undefined)
    try {
      await this.report(run, 'failed', reason)
    } catch (error) {
      logger.warn('Could not report playback failure', { sessionId: run.sessionId, reason: errorReason(error) })
      if (run.stopped || run.audio !== audio || run.target?.attemptId !== attemptId) return
      const wasVisible = this.visibleRun === run
      try {
        await this.terminate(run, false)
      } catch {
        return
      }
      if (wasVisible && !this.visibleRun) this.publishFailure(run.sourceLabel, run.chunks.length, reason)
    }
  }

  private async handleFailure(run: PlaybackRun, reason: VoiceErrorReason): Promise<void> {
    const state = this.voice.getSnapshot()
    if (state.phase !== 'idle' && state.sessionId === run.sessionId) {
      if (state.playback?.failure) {
        this.publish(run)
        return
      }
      if (run.target) {
        await this.failPlayback(run, reason)
        return
      }
    } else if (reason === 'busy' && !run.outputId) {
      this.rejectUnadmittedRun(run, reason)
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
    if (event.command === 'stop') {
      if (event.playback?.desired === 'stopped') this.acceptTarget(run, event.playback)
      void this.terminate(run, true).catch(() => undefined)
      return
    }
    if (!event.playback) return
    this.acceptTarget(run, event.playback)
    const attemptId = run.target?.attemptId
    void this.executeTarget(run).catch((error: unknown) => {
      if (run.stopped || run.target?.attemptId !== attemptId) return
      return this.failPlayback(run, errorReason(error))
    })
  }

  private terminate(run: PlaybackRun, publishIdle: boolean): Promise<void> {
    if (run.cleanup) return run.cleanup
    run.stopped = true
    run.textInput?.cancel()
    run.detachAbort?.()
    run.detachAbort = undefined
    run.cleanupError = undefined
    const localCleanup = this.disposeAudio(run)
    const cleanup = (async () => {
      const tasks = [
        localCleanup,
        ...(run.inputTask ? [run.inputTask] : []),
        run.target?.desired === 'stopped'
          ? this.report(run, 'stopped').then(() => undefined)
          : this.voice.discardSession(run.sessionId)
      ]
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
        this.publish(run)
        throw run.cleanupError
      })
      .finally(() => {
        if (run.cleanup === cleanup) run.cleanup = undefined
      })
    run.cleanup = cleanup
    return cleanup
  }

  private releaseRun(run: PlaybackRun, publishIdle: boolean): void {
    run.textInput?.cancel()
    run.detachAbort?.()
    run.detachAbort = undefined
    this.runs.delete(run.sessionId)
    if (this.visibleRun !== run) return
    this.visibleRun = undefined
    if (publishIdle) this.setSnapshot(IDLE_SNAPSHOT)
  }

  private rejectUnadmittedRun(run: PlaybackRun, reason: VoiceErrorReason): void {
    run.detachAbort?.()
    run.detachAbort = undefined
    if (this.runs.get(run.sessionId) === run) this.runs.delete(run.sessionId)
    if (this.visibleRun !== run) return
    this.visibleRun = undefined
    this.publishFailure(run.sourceLabel, run.chunks.length, reason)
  }

  private disposeAudio(run: PlaybackRun): Promise<void> {
    run.pendingEnded = undefined
    const audio = run.audio
    run.audio = undefined
    run.audioAttemptId = undefined
    if (audio) {
      if (run.ended) audio.removeEventListener('ended', run.ended)
      if (run.failed) audio.removeEventListener('error', run.failed)
    }
    run.ended = undefined
    run.failed = undefined
    if (!audio) return run.audioCleanup ?? Promise.resolve()
    const cleanup = audio.close().then(() => {
      if (run.audioCleanup === cleanup) run.audioCleanup = undefined
    })
    run.audioCleanup = cleanup
    return cleanup
  }

  private assertCurrent(run: PlaybackRun, audio?: SpeechPlayback): void {
    if (
      run.stopped ||
      run.generation !== this.lifecycleGeneration ||
      this.runs.get(run.sessionId) !== run ||
      (audio && run.audio !== audio)
    ) {
      throw new VoiceDomainError('aborted')
    }
  }

  private publish(run: PlaybackRun): void {
    if (this.visibleRun !== run) return
    if (run.cleanupError) {
      this.setSnapshot({
        phase: 'failed',
        sourceLabel: run.sourceLabel,
        progress: { completed: run.completed, total: run.chunks.length },
        error: run.cleanupError.reason
      })
      return
    }
    const state = this.voice.getSnapshot()
    if (state.phase === 'idle' || state.sessionId !== run.sessionId || !state.playback) return
    this.setSnapshot({
      phase: state.phase as Exclude<SpeechPlaybackPhase, 'idle'>,
      sourceLabel: run.sourceLabel,
      progress: { completed: run.completed, total: run.chunks.length },
      ...(run.audio?.analyser && { analyser: run.audio.analyser }),
      ...(state.playback.failure && { error: state.playback.failure.reason })
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
    this.unsubscribeState?.()
    this.unsubscribeState = undefined
    this.unsubscribeCommands?.()
    this.unsubscribeCommands = undefined
    this.unsubscribeInterruptions?.()
    this.unsubscribeInterruptions = undefined
    this.ownerWindow.removeEventListener('beforeunload', this.handleBeforeUnload)
  }

  private readonly handleBeforeUnload = (): void => {
    void this.teardown().catch(() => undefined)
  }
}

export const speechPlaybackService = new SpeechPlaybackService()
