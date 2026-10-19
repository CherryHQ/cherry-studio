import { mkdir, rm } from 'node:fs/promises'

import type { WebContents } from 'electron'
import { session as electronSession } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isAppRendererUrl } from '@main/core/security/validateSender'
import { WindowType } from '@main/core/window/types'
import { MediaKind } from '@main/services/mediaProtocol'
import type { LocalTranscriptionModelId, LocalSpeechModelId } from '@shared/ai/localVoice'
import { type LocalVoiceModelId, type VoiceSessionSource, type VoiceSessionTrigger } from '@shared/ai/localVoice'
import { SpeechInputKind, SpeechOutputKind, TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'
import type { FileEntryId, InternalFileEntry } from '@shared/data/types/file'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'
import type { VoiceSessionCommand, VoiceSessionPhase, VoiceSessionState } from '@shared/ipc/schemas/voice'
import type { InputFor, OutputFor } from '@shared/ipc/types'

import { startSpeech, startTranscription } from './execution'
import type { VoiceExecution } from './executionTypes'
import {
  getLocalVoiceStatus,
  installVoiceLocale,
  describeVoiceModel,
  listVoiceModels,
  resolveTranscriptionConfiguration,
  resolveSpeechConfiguration,
  getVoiceAdapterId,
  resolveTranscriptionRequest,
  resolveSpeechRequest,
  downloadVoiceModel,
  cancelVoiceModelDownload,
  removeVoiceModel,
  listLocalAsrLocales,
  listLocalVoices,
  voiceAudioProcess
} from './localAdapters'
import {
  applyPlaybackCommand,
  applyPlaybackReport,
  beginPlaybackSynthesis,
  completePlaybackSynthesis,
  readyPlaybackOutput,
  createPlaybackSnapshot,
  createPlaybackState,
  failPlayback,
  playbackPhase,
  type PlaybackState
} from './playbackState'
import { VoiceInputStream } from './VoiceInputStream'
import { getMicrophoneStatus, openMicrophoneSettings, openSystemVoiceSettings } from './voicePlatform'
import { VoiceRuntimeError } from './VoiceRuntimeError'
import { VoiceStream } from './VoiceStream'
import { VoiceTextInput } from './VoiceTextInput'

const logger = loggerService.withContext('VoiceSessionService')
const PLAYBACK_CONFIRMATION_TIMEOUT_MS = 15_000

type VoiceWebContents = Pick<WebContents, 'id' | 'isDestroyed' | 'on' | 'once' | 'removeListener'>

export interface VoiceOwner {
  windowId: string
  webContents: VoiceWebContents
}

type SessionFile = { entry: InternalFileEntry; reference: Disposable }
type VoiceOperation = 'speech' | 'transcription' | 'install'
type AbortableVoiceOperation = Exclude<VoiceOperation, 'install'>
type ActivePhase = Exclude<VoiceSessionPhase, 'idle'>
type SessionKind = 'recording' | 'playback' | 'install'
type Session = {
  id: string
  owner: VoiceOwner
  kind: SessionKind
  source?: VoiceSessionSource
  sourceEntityId?: string
  trigger?: VoiceSessionTrigger
  phase?: ActivePhase
  closed: boolean
  files: Map<FileEntryId, SessionFile>
  pending: Set<Promise<unknown>>
  attach: () => void
  detach: () => void
  requestId?: string
  // Not an inspection: the next manual admission must still be able to displace it.
  preflightAbort?: AbortController
  execution?: VoiceExecution
  operation?: VoiceOperation
  speechPlan?: ReturnType<typeof resolveSpeechRequest>
  selectedModel?: LocalVoiceModelId
  resolvedAdapter?: string
  terminalStatus?: 'completed' | 'failed' | 'aborted'
  cleanup?: Promise<void>
  textInput?: VoiceTextInput
  inputStream?: VoiceInputStream
  stream?: VoiceStream
  outputId?: string
  chunkCount?: number
  currentChunkIndex?: number
  nextChunkIndex?: number
  generatedUnchunked?: boolean
  playback?: PlaybackState
  playbackTimeout?: ReturnType<typeof setTimeout>
}
type ActiveOperation = { session: Session; requestId: string; controller: AbortController }

@Injectable('VoiceSessionService')
@ServicePhase(Phase.WhenReady)
@DependsOn([
  'TtsInferenceService',
  'AsrInferenceService',
  'FileManager',
  'WindowManager',
  'UtilityProcessManager',
  'PowerService',
  'MediaProtocolService'
])
export class VoiceSessionService extends BaseService {
  private accepting = false
  private readonly sessions = new Map<string, Session>()
  private active?: ActiveOperation
  private lease?: Session
  private sleepHold?: Disposable
  private powerEpoch = 0
  private revision = 0
  private voiceState: VoiceSessionState = { phase: 'idle', revision: 0 }
  private readonly inspections = new Map<Promise<unknown>, AbortController>()

  protected override async onInit(): Promise<void> {
    const scratch = application.getPath('feature.voice.temp')
    await rm(scratch, { recursive: true, force: true })
    await mkdir(scratch, { recursive: true, mode: 0o700 })
    application.get('UtilityProcessManager').register(voiceAudioProcess)
    this.accepting = true
    this.installMicrophonePermissionHandlers()
    const power = application.get('PowerService')
    this.registerDisposable(power.onSuspend(() => this.handlePowerInterruption()))
    this.registerDisposable(power.onLockScreen(() => this.handlePowerInterruption()))
    this.registerDisposable(() => {
      for (const session of this.sessions.values()) session.detach()
    })
  }

  protected override async onStop(): Promise<void> {
    this.accepting = false
    for (const controller of this.inspections.values()) controller.abort(new VoiceRuntimeError('aborted'))
    const cleanup = [...this.sessions.values()].map((session) => this.closeSession(session, true))
    const [results] = await Promise.all([Promise.allSettled(cleanup), Promise.allSettled(this.inspections.keys())])
    this.releaseLease()
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
    if (failures.length) throw new AggregateError(failures, 'Voice session cleanup failed')
  }

  protected override async onDestroy(): Promise<void> {
    await this.onStop()
  }

  getState(owner: VoiceOwner): VoiceSessionState {
    this.requireAdmission()
    this.requireOwner(owner)
    if (!this.hasSessionAccess(owner)) return { phase: 'idle', revision: this.voiceState.revision }
    return { ...this.voiceState }
  }

  listModels() {
    this.requireAdmission()
    return listVoiceModels()
  }

  resolveTranscription(owner: VoiceOwner, input: InputFor<'ai.voice.transcription.resolve'>) {
    return this.inspect(owner, (signal) => resolveTranscriptionConfiguration(input, signal))
  }

  resolveSpeech(owner: VoiceOwner, input: InputFor<'ai.voice.speech.resolve'>) {
    return this.inspect(owner, (signal) => resolveSpeechConfiguration(input, signal))
  }

  describeModel(modelId: string) {
    this.requireAdmission()
    return describeVoiceModel(modelId)
  }

  downloadModel(owner: VoiceOwner, modelId: LocalVoiceModelId) {
    this.requireAdmission()
    this.requireOwner(owner)
    return downloadVoiceModel(modelId)
  }

  cancelModelDownload(owner: VoiceOwner, modelId: LocalVoiceModelId) {
    this.requireAdmission()
    this.requireOwner(owner)
    return cancelVoiceModelDownload(modelId)
  }

  removeModel(owner: VoiceOwner, modelId: LocalVoiceModelId) {
    this.requireAdmission()
    this.requireOwner(owner)
    return removeVoiceModel(modelId)
  }

  listTranscriptionLocales(owner: VoiceOwner, modelId: LocalTranscriptionModelId) {
    return this.inspect(owner, (signal) => listLocalAsrLocales(modelId, signal))
  }

  status(owner: VoiceOwner, input: InputFor<'ai.voice.model.status'>) {
    return this.inspect(owner, (signal) => getLocalVoiceStatus(input.modelId, input, signal))
  }

  voices(owner: VoiceOwner, modelId: LocalSpeechModelId) {
    return this.inspect(owner, async (signal) =>
      (await listLocalVoices(modelId, signal)).map(({ id, name, locale, languages }) => ({
        id,
        name,
        language: locale,
        ...(languages && { languages: [...languages] })
      }))
    )
  }

  async startRecording(owner: VoiceOwner, input: InputFor<'ai.voice.recording.start'>): Promise<VoiceSessionState> {
    this.requireAdmission()
    this.requireOwner(owner)
    const powerEpoch = this.powerEpoch
    if (input.source === 'settings' && (this.lease || this.active)) throw new VoiceRuntimeError('busy')
    if ((this.lease ?? this.active?.session)?.kind === 'recording') throw new VoiceRuntimeError('busy')
    const session = this.createSession(owner, input.sessionId, 'recording', input.source, input.sourceEntityId)
    session.requestId = input.requestId
    try {
      if (this.inspections.size) {
        for (const controller of this.inspections.values()) controller.abort(new VoiceRuntimeError('aborted'))
        await Promise.allSettled(this.inspections.keys())
      }
      while (this.lease || this.active) {
        if (input.source === 'settings') throw new VoiceRuntimeError('busy')
        const displaced = this.lease ?? this.active!.session
        if (displaced.kind === 'recording') throw new VoiceRuntimeError('busy')
        if (this.lease === displaced && !displaced.closed) this.sendCommand(displaced, 'stop')
        await this.closeSession(displaced, true)
      }
      if (session.closed || powerEpoch !== this.powerEpoch) throw new VoiceRuntimeError('aborted')
      this.acquireLease(session)
      return this.transition(session, 'recording')
    } catch (error) {
      await this.closeSession(session, true)
      throw error
    }
  }

  async createRecording(owner: VoiceOwner, input: InputFor<'file.voice_recording.create'>): Promise<InternalFileEntry> {
    this.requireAdmission()
    this.requireOwner(owner)
    if (
      input.mimeType !== 'audio/webm;codecs=opus' ||
      input.audio.byteLength < 4 ||
      input.audio.byteLength > 32 * 1024 * 1024 ||
      !Buffer.from(input.audio.subarray(0, 4)).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    )
      throw new VoiceRuntimeError('invalid_audio')
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'recording' || session.phase !== 'recording' || session.files.size || session.pending.size)
      throw new VoiceRuntimeError('invalid_request')
    const entry = await this.track(session, this.createFile(session, input.audio, 'webm'))
    if (session.closed) throw new VoiceRuntimeError('aborted')
    this.transition(session, 'recorded')
    logger.debug('Voice recording captured', {
      sessionId: session.id,
      requestId: session.requestId,
      operation: 'recording',
      state: 'recorded',
      source: session.source,
      mimeType: input.mimeType,
      durationMs: input.durationMs
    })
    return entry
  }

  async startStreamingTranscription(owner: VoiceOwner, input: InputFor<'ai.voice.transcription.start'>) {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'recording' || session.phase !== 'recording' || session.inputStream)
      throw new VoiceRuntimeError('invalid_request')
    const { modelId, options } = resolveTranscriptionRequest(input)
    try {
      const result = await this.run(
        session,
        input.requestId,
        modelId,
        'transcription',
        async (signal) => {
          const source = new VoiceInputStream()
          session.inputStream = source
          const abort = () => source.close()
          signal.addEventListener('abort', abort, { once: true })
          const deadline = setTimeout(() => {
            if (this.active?.session === session) this.active.controller.abort(new VoiceRuntimeError('timeout'))
          }, 420_000)
          deadline.unref()
          try {
            const execution = startTranscription(
              {
                modelId,
                input: { kind: TranscriptionInputKind.PcmStream, format: input.format, chunks: source },
                output: TranscriptionOutputKind.Revisions,
                options
              },
              signal
            )
            const updates = (async () => {
              for await (const update of execution.updates) {
                signal.throwIfAborted()
                application.get('IpcApiService').send(owner.windowId, 'ai.voice.transcript_event', {
                  sessionId: session.id,
                  requestId: input.requestId,
                  type: 'revision',
                  update
                })
              }
            })()
            const work = (async () => {
              await execution.ready
              signal.throwIfAborted()
              application.get('IpcApiService').send(owner.windowId, 'ai.voice.transcript_event', {
                sessionId: session.id,
                requestId: input.requestId,
                type: 'ready'
              })
              const [result] = await Promise.all([execution.completed, updates])
              return result
            })()
            void updates.catch(() => undefined)
            return await this.consumeExecution(session, execution, work)
          } finally {
            clearTimeout(deadline)
            source.close()
            signal.removeEventListener('abort', abort)
            session.inputStream = undefined
          }
        },
        { failurePhase: 'failed' }
      )
      await this.closeSession(session)
      return { text: result.text }
    } catch (error) {
      await this.closeSession(session, true)
      throw error
    }
  }

  writeInput(owner: VoiceOwner, input: InputFor<'ai.voice.input.write'>): Promise<void> {
    return this.requireInputStream(owner, input).write({ startFrame: input.startFrame, samples: input.samples })
  }

  finishInput(owner: VoiceOwner, input: InputFor<'ai.voice.input.finish'>): void {
    const source = this.requireInputStream(owner, input)
    source.finish(input.frames)
    this.transition(this.requireLeaseSession(owner, input.sessionId), 'recognizing')
  }

  private requireInputStream(owner: VoiceOwner, input: { sessionId: string; requestId: string }): VoiceInputStream {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (!session.inputStream || session.requestId !== input.requestId || session.closed)
      throw new VoiceRuntimeError('invalid_request')
    return session.inputStream
  }

  async transcribe(owner: VoiceOwner, input: InputFor<'ai.transcription.generate'>) {
    if (this.active || this.inspections.size) throw new VoiceRuntimeError('busy')
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'recording' || !['recorded', 'failed'].includes(session.phase ?? ''))
      throw new VoiceRuntimeError('invalid_request')
    if (!session.files.has(input.fileEntryId)) throw new VoiceRuntimeError('forbidden_owner')
    const {
      modelId,
      options: { language }
    } = resolveTranscriptionRequest(input)
    const result = await this.run(
      session,
      input.requestId,
      modelId,
      'transcription',
      async (signal) => {
        const files = application.get('FileManager')
        const entry = await files.getById(input.fileEntryId)
        if (
          entry.origin !== 'internal' ||
          entry.ext !== 'webm' ||
          entry.cleanupPolicy !== 'delete_when_unreferenced' ||
          entry.deletedAt ||
          entry.size > 32 * 1024 * 1024
        )
          throw new VoiceRuntimeError('invalid_audio')
        const audio = await files.read(input.fileEntryId, { encoding: 'binary' })
        if (!['audio/webm', 'video/webm', 'audio/webm;codecs=opus'].includes(audio.mime))
          throw new VoiceRuntimeError('invalid_audio')
        signal.throwIfAborted()
        const execution = startTranscription(
          {
            modelId,
            input: { kind: TranscriptionInputKind.Audio, audio: audio.content },
            output: TranscriptionOutputKind.Final,
            options: { language }
          },
          signal
        )
        const transcript = await this.consumeExecution(session, execution, execution.completed)
        signal.throwIfAborted()
        await this.deleteFile(session, input.fileEntryId)
        return { sessionId: session.id, requestId: input.requestId, ...transcript }
      },
      {
        startPhase: 'recognizing',
        failurePhase: 'failed',
        log: { locale: language, mimeType: 'audio/webm;codecs=opus' }
      }
    )
    await this.closeSession(session)
    return result
  }

  writeText(owner: VoiceOwner, input: InputFor<'ai.voice.text.write'>): Promise<void> {
    return this.requireTextInput(owner, input).write(input.sequence, input.event)
  }

  finishText(owner: VoiceOwner, input: InputFor<'ai.voice.text.finish'>): void {
    this.requireTextInput(owner, input).finish(input.sequence)
  }

  private requireTextInput(owner: VoiceOwner, input: { sessionId: string; requestId: string }): VoiceTextInput {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (!session.textInput || session.requestId !== input.requestId || session.closed)
      throw new VoiceRuntimeError('invalid_request')
    return session.textInput
  }

  async speech(owner: VoiceOwner, input: InputFor<'ai.speech.generate'>) {
    const resolvesPreferences = input.preferenceResolution === true
    if (resolvesPreferences) {
      resolveSpeechRequest({
        modelId: input.modelId,
        voice: input.voice ?? '',
        language: input.language,
        speed: input.speed
      })
    }
    let plan = resolvesPreferences ? undefined : resolveSpeechRequest(input)
    const trigger = input.trigger ?? 'manual'
    const session = await this.preparePlayback(owner, input, trigger)
    try {
      let resolved: OutputFor<'ai.speech.generate'>['resolved']
      if (resolvesPreferences && !session.speechPlan) {
        const powerEpoch = this.powerEpoch
        const configuration = await this.resolveAdmittedSpeech(session, input)
        if (session.closed || session.requestId !== input.requestId || powerEpoch !== this.powerEpoch) {
          throw new VoiceRuntimeError('aborted')
        }
        if (!configuration.modelId || !configuration.voice || configuration.status.status !== 'ready') {
          throw new VoiceRuntimeError(configuration.status.reason ?? 'voice_unavailable')
        }
        plan = resolveSpeechRequest({
          modelId: configuration.modelId,
          voice: configuration.voice,
          language: configuration.language,
          speed: configuration.speed
        })
        resolved = {
          modelId: plan.modelId,
          voice: configuration.voice,
          ...(configuration.language && { language: configuration.language }),
          speed: plan.options.speed
        }
      }
      plan ??= resolveSpeechRequest(input)
      if (!plan.options.voice) throw new VoiceRuntimeError('voice_unavailable')
      const { modelId, options: speechOptions } = plan
      const definiteOptions = { ...speechOptions, voice: plan.options.voice }
      if (
        session.speechPlan &&
        (session.speechPlan.modelId !== modelId ||
          session.speechPlan.options.voice !== speechOptions.voice ||
          session.speechPlan.options.language !== speechOptions.language ||
          session.speechPlan.options.speed !== speechOptions.speed)
      )
        throw new VoiceRuntimeError('invalid_request')
      session.speechPlan ??= plan
      const normalizedText = input.text.normalize('NFC').trim()
      const ready = Promise.withResolvers<OutputFor<'ai.speech.generate'>>()
      const inputKind = input.textStream ? SpeechInputKind.TextStream : SpeechInputKind.Text
      const streaming =
        (input.preferStream || input.textStream) &&
        describeVoiceModel(modelId).model?.voiceCapabilities.speech?.some(
          (operation) => operation.input === inputKind && operation.output === SpeechOutputKind.PcmStream
        )
      if (input.textStream && (!streaming || input.remainingText?.length || input.retryAttemptId !== undefined))
        throw new VoiceRuntimeError('unsupported')
      const work = this.run(
        session,
        input.requestId,
        modelId,
        'speech',
        async (signal) => {
          if (input.textStream) session.textInput = new VoiceTextInput(normalizedText)
          const execution = startSpeech(
            {
              modelId,
              input: session.textInput
                ? { kind: SpeechInputKind.TextStream, events: session.textInput }
                : {
                    kind: SpeechInputKind.Text,
                    text: streaming ? [normalizedText, ...(input.remainingText ?? [])].join('\n') : normalizedText
                  },
              output: streaming ? SpeechOutputKind.PcmStream : SpeechOutputKind.Audio,
              options: definiteOptions
            },
            signal
          )
          session.execution = execution
          try {
            const result = await execution.output
            if (result.kind === SpeechOutputKind.PcmStream) {
              const stream = new VoiceStream(
                { sessionId: session.id, requestId: input.requestId, attemptId: session.playback!.attemptId },
                result.format,
                signal,
                (event) => application.get('IpcApiService').send(owner.windowId, 'ai.voice.stream_event', event),
                () => {
                  try {
                    this.sendCommand(session, 'stop')
                  } catch {
                    logger.warn('Expired voice stream owner unavailable')
                  }
                  void this.closeSession(session, true).catch(() => logger.warn('Expired voice stream cleanup failed'))
                }
              )
              session.stream = stream
              session.generatedUnchunked = true
              session.playback = readyPlaybackOutput(session.playback!)
              this.publishPlayback(session)
              const response: OutputFor<'ai.speech.generate'> = {
                sessionId: session.id,
                requestId: input.requestId,
                output: {
                  kind: SpeechOutputKind.PcmStream,
                  id: input.requestId,
                  ...result.format,
                  capacityFrames: stream.capacityFrames
                },
                playback: createPlaybackSnapshot(session.playback, false),
                ...(resolved && { resolved })
              }
              ready.resolve(response)
              await stream.relay(result.chunks, execution.completed)
              session.playback = completePlaybackSynthesis(session.playback)
              this.publishPlayback(session)
              return response
            }
            await this.consumeExecution(session, execution, Promise.resolve(result))
            signal.throwIfAborted()
            const wav = Buffer.from(result.audio)
            if (
              result.mediaType !== 'audio/wav' ||
              wav.length < 44 ||
              wav.toString('ascii', 0, 4) !== 'RIFF' ||
              wav.toString('ascii', 8, 12) !== 'WAVE' ||
              wav.readUInt32LE(4) + 8 !== wav.length
            )
              throw new VoiceRuntimeError('invalid_audio')
            if (session.closed || !this.accepting || session.owner.webContents.isDestroyed())
              throw new VoiceRuntimeError('aborted')
            const media = application.get('MediaProtocolService')
            const outputId = media.store(MediaKind.Audio, wav, 'audio/wav', { webContentsId: owner.webContents.id })
            session.outputId = outputId
            session.currentChunkIndex = input.chunkIndex
            if (input.chunkIndex === undefined) session.generatedUnchunked = true
            signal.throwIfAborted()
            session.playback = completePlaybackSynthesis(session.playback!)
            this.publishPlayback(session)
            this.armPlaybackTimeout(session)
            return {
              sessionId: session.id,
              requestId: input.requestId,
              output: {
                kind: SpeechOutputKind.Audio,
                id: outputId,
                url: media.getUrl(MediaKind.Audio, outputId),
                mimeType: 'audio/wav' as const
              },
              playback: createPlaybackSnapshot(session.playback, true)
            }
          } finally {
            session.textInput?.close()
            if (session.execution === execution) {
              await execution.cancel()
              session.execution = undefined
            }
          }
        },
        {
          startPhase: 'generating',
          failurePhase: 'failed',
          cleanupOnFailure: true,
          log: {
            locale: definiteOptions.language,
            normalizedTextLength: normalizedText.length,
            chunkIndex: input.chunkIndex,
            chunkCount: input.chunkCount
          }
        }
      )
      void work.then(ready.resolve, ready.reject)
      const result = await ready.promise
      return resolved ? { ...result, resolved } : result
    } catch (error) {
      await this.abandonUnstartedPlayback(session, input.requestId)
      throw error
    }
  }

  attachStream(owner: VoiceOwner, input: InputFor<'ai.voice.stream.attach'>): void {
    this.requireStream(owner, input)?.attach()
  }

  acknowledgeStream(owner: VoiceOwner, input: InputFor<'ai.voice.stream.acknowledge'>): void {
    this.requireStream(owner, input)?.acknowledge(input.frames)
  }

  private requireStream(owner: VoiceOwner, input: InputFor<'ai.voice.stream.attach'>): VoiceStream | undefined {
    const session = this.requireLeaseSession(owner, input.sessionId)
    const stream = session.stream
    if (!stream || stream.identity.requestId !== input.requestId || stream.identity.attemptId !== input.attemptId)
      return undefined
    return stream
  }

  async releaseOutput(owner: VoiceOwner, input: InputFor<'ai.voice.output.release'>): Promise<void> {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'playback') throw new VoiceRuntimeError('forbidden_owner')
    if (!session.outputId) return
    if (session.outputId !== input.outputId) throw new VoiceRuntimeError('forbidden_owner')
    this.removeOutput(session)
    if (session.currentChunkIndex !== undefined) session.nextChunkIndex = session.currentChunkIndex + 1
    session.currentChunkIndex = undefined
  }

  private removeOutput(session: Session): void {
    if (!session.outputId) return
    application.get('MediaProtocolService').remove(MediaKind.Audio, session.outputId)
    session.outputId = undefined
  }

  async reportPlayback(owner: VoiceOwner, input: InputFor<'ai.voice.playback.report'>): Promise<VoiceSessionState> {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (!session.playback) throw new VoiceRuntimeError('invalid_request')
    const next = applyPlaybackReport(session.playback, input)
    if (next === session.playback) return this.getState(owner)
    if ((input.phase === 'completed' || input.phase === 'ended') && session.stream && !session.stream.drained)
      throw new VoiceRuntimeError('invalid_request')
    if (input.phase === 'completed' && session.outputId) throw new VoiceRuntimeError('invalid_request')
    if (input.phase === 'failed' && session.stream) {
      session.stream.close()
      await session.execution?.cancel()
      await Promise.allSettled(session.pending)
      if (session.closed) return this.getState(owner)
    }
    session.playback = next
    if (!next.pendingCommand) this.clearPlaybackTimeout(session)
    if (input.phase === 'completed' || input.phase === 'stopped') {
      await this.closeSession(session, input.phase === 'stopped')
      return this.getState(owner)
    }
    return this.publishPlayback(session)
  }

  async controlPlayback(owner: VoiceOwner, input: InputFor<'ai.voice.playback.control'>): Promise<VoiceSessionState> {
    this.requireControlOwner(owner)
    const session = this.lease
    if (!session || session.id !== input.sessionId || session.closed || !session.playback) {
      throw new VoiceRuntimeError('invalid_request')
    }
    const next = applyPlaybackCommand(
      session.playback,
      input.command,
      Boolean(session.outputId || (session.stream && !session.textInput))
    )
    if (next === session.playback) return this.getState(owner)
    if (input.command === 'retry' && session.stream) {
      session.stream.close()
      await session.execution?.cancel()
      await Promise.allSettled(session.pending)
      if (session.closed || this.lease !== session) throw new VoiceRuntimeError('aborted')
    }
    session.playback =
      input.command === 'retry' && session.stream ? { ...next, synthesis: 'generating', observed: 'empty' } : next
    this.publishPlayback(session)
    this.armPlaybackTimeout(session)
    try {
      this.sendCommand(session, input.command)
    } catch {
      session.playback = failPlayback(next, 'control', 'operation_failed')
      this.clearPlaybackTimeout(session)
      this.publishPlayback(session)
      throw new VoiceRuntimeError('operation_failed')
    }
    return this.getState(owner)
  }

  private publishPlayback(session: Session): VoiceSessionState {
    return this.transition(session, playbackPhase(session.playback!), session.playback?.failure?.reason)
  }

  private clearPlaybackTimeout(session: Session): void {
    clearTimeout(session.playbackTimeout)
    session.playbackTimeout = undefined
  }

  private armPlaybackTimeout(session: Session): void {
    this.clearPlaybackTimeout(session)
    const playback = session.playback!
    if (!playback.pendingCommand) return
    if (playback.synthesis === 'generating' && playback.desired !== 'stopped') return
    session.playbackTimeout = setTimeout(() => {
      session.playbackTimeout = undefined
      if (session.closed || session.playback?.commandRevision !== playback.commandRevision) return
      session.playback = failPlayback(session.playback, 'control', 'operation_failed')
      this.publishPlayback(session)
    }, PLAYBACK_CONFIRMATION_TIMEOUT_MS)
    session.playbackTimeout.unref()
  }

  getMicrophoneStatus(owner: VoiceOwner): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' {
    this.requireAdmission()
    this.requireOwner(owner)
    return getMicrophoneStatus()
  }

  async openSystemVoiceSettings(owner: VoiceOwner): Promise<void> {
    this.requireAdmission()
    this.requireOwner(owner)
    await openSystemVoiceSettings()
  }

  async openMicrophoneSettings(owner: VoiceOwner): Promise<void> {
    this.requireAdmission()
    this.requireOwner(owner)
    await openMicrophoneSettings()
  }

  async installAsset(owner: VoiceOwner, input: InputFor<'ai.transcription.asset.install'>): Promise<void> {
    if (this.active || this.inspections.size || this.lease) throw new VoiceRuntimeError('busy')
    const session = this.createSession(owner, input.sessionId, 'install', input.source)
    await this.run(
      session,
      input.requestId,
      input.modelId,
      'install',
      async (signal) => {
        await installVoiceLocale(input.modelId, input.language, signal)
      },
      { log: { locale: input.language } }
    )
  }

  async abort(
    owner: VoiceOwner,
    input: InputFor<'ai.speech.abort'>,
    expectedOperation: AbortableVoiceOperation
  ): Promise<void> {
    this.requireOwner(owner)
    const session = this.sessions.get(input.sessionId)
    if (!session) return
    this.assertOwner(session, owner)
    const activeMatches =
      this.active?.session === session &&
      this.active.requestId === input.requestId &&
      session.operation === expectedOperation
    const preflightMatches =
      expectedOperation === 'speech' &&
      session.preflightAbort !== undefined &&
      session.requestId === input.requestId &&
      session.operation === undefined
    if (!activeMatches && !preflightMatches) return
    await this.closeSession(session, true)
  }

  async discard(owner: VoiceOwner, sessionId: string): Promise<void> {
    this.requireOwner(owner)
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.assertOwner(session, owner)
    await this.closeSession(session)
  }

  private async preparePlayback(
    owner: VoiceOwner,
    input: InputFor<'ai.speech.generate'>,
    trigger: VoiceSessionTrigger
  ): Promise<Session> {
    this.requireAdmission()
    this.requireOwner(owner)
    const powerEpoch = this.powerEpoch
    if (this.inspections.size) throw new VoiceRuntimeError('busy')
    if (this.lease?.kind === 'playback' && this.lease.id === input.sessionId && !this.active) {
      const session = this.lease
      this.assertOwner(session, owner)
      if (session.files.size || session.pending.size || session.outputId) throw new VoiceRuntimeError('busy')
      if (
        input.retryAttemptId !== undefined &&
        session.stream &&
        session.playback?.pendingCommand === 'retry' &&
        session.playback.attemptId === input.retryAttemptId
      ) {
        session.stream = undefined
        return session
      }
      if (input.retryAttemptId !== undefined) throw new VoiceRuntimeError('invalid_request')
      this.validateNextChunk(session, input, trigger)
      return session
    }
    if (input.retryAttemptId !== undefined) throw new VoiceRuntimeError('invalid_request')
    if (trigger === 'auto_read' && (this.lease || this.active)) throw new VoiceRuntimeError('busy')
    const occupied = this.lease ?? this.active?.session
    if (occupied && (occupied.kind !== 'playback' || this.lease !== occupied)) throw new VoiceRuntimeError('busy')
    const session = this.createSession(owner, input.sessionId, 'playback', input.source, input.sourceEntityId, trigger)
    session.requestId = input.requestId
    session.chunkCount = input.chunkCount
    try {
      while (this.lease || this.active) {
        const occupied = this.lease ?? this.active!.session
        if (trigger !== 'manual' || occupied.kind !== 'playback' || this.lease !== occupied) {
          throw new VoiceRuntimeError('busy')
        }
        if (!occupied.closed) this.sendCommand(occupied, 'stop')
        await this.closeSession(occupied, true)
      }

      if (session.closed || powerEpoch !== this.powerEpoch) throw new VoiceRuntimeError('aborted')
      if (input.chunkIndex !== undefined && input.chunkIndex !== 0) throw new VoiceRuntimeError('invalid_request')
      this.acquireLease(session)
      session.playback = beginPlaybackSynthesis(session.playback!)
      this.publishPlayback(session)
      return session
    } catch (error) {
      await this.closeSession(session, true)
      throw error
    }
  }

  private validateNextChunk(
    session: Session,
    input: InputFor<'ai.speech.generate'>,
    trigger: VoiceSessionTrigger
  ): void {
    if (session.generatedUnchunked || input.chunkIndex === undefined || input.chunkCount === undefined) {
      throw new VoiceRuntimeError('invalid_request')
    }
    if (
      session.chunkCount !== input.chunkCount ||
      session.nextChunkIndex !== input.chunkIndex ||
      session.source !== input.source ||
      session.sourceEntityId !== input.sourceEntityId ||
      session.trigger !== trigger
    ) {
      throw new VoiceRuntimeError('invalid_request')
    }
  }

  private requireAdmission(): void {
    if (!this.accepting) throw new VoiceRuntimeError('stopped')
  }

  private requireOwner(owner: VoiceOwner): void {
    if (!owner.windowId || owner.webContents.isDestroyed()) throw new VoiceRuntimeError('forbidden_owner')
    const managed = application.get('WindowManager').getWindow(owner.windowId)
    if (!managed || managed.webContents !== owner.webContents || managed.isDestroyed()) {
      throw new VoiceRuntimeError('forbidden_owner')
    }
  }

  private requireControlOwner(owner: VoiceOwner): void {
    this.requireAdmission()
    this.requireOwner(owner)
    if (!this.hasSessionAccess(owner)) throw new VoiceRuntimeError('forbidden_owner')
  }

  private hasSessionAccess(owner: VoiceOwner): boolean {
    if (this.lease?.owner.windowId === owner.windowId && this.lease.owner.webContents === owner.webContents) return true
    const type = application.get('WindowManager').getWindowType(owner.windowId)
    return type === WindowType.Main || type === WindowType.SubWindow
  }

  private assertOwner(session: Session, owner: VoiceOwner): void {
    if (session.owner.windowId !== owner.windowId || session.owner.webContents !== owner.webContents)
      throw new VoiceRuntimeError('forbidden_owner')
  }

  private requireLeaseSession(owner: VoiceOwner, id: string): Session {
    this.requireAdmission()
    this.requireOwner(owner)
    const session = this.sessions.get(id)
    if (session) this.assertOwner(session, owner)
    if (!session || this.lease !== session || session.closed) throw new VoiceRuntimeError('invalid_request')
    return session
  }

  private createSession(
    owner: VoiceOwner,
    id: string,
    kind: SessionKind,
    source?: VoiceSessionSource,
    sourceEntityId?: string,
    trigger?: VoiceSessionTrigger
  ): Session {
    this.requireAdmission()
    this.requireOwner(owner)
    const existing = this.sessions.get(id)
    if (existing) {
      this.assertOwner(existing, owner)
      throw new VoiceRuntimeError('invalid_request')
    }
    const terminate = () => {
      void this.closeSession(session, true).catch(() =>
        logger.warn('Voice cleanup failed', { sessionId: id, category: 'operation_failed' })
      )
    }
    const navigation = (...args: unknown[]) => {
      const details = args[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined
      const isMainFrame = details?.isMainFrame ?? (args[3] as boolean | undefined)
      const isInPlace = details?.isSameDocument ?? (args[2] as boolean | undefined)
      if (isMainFrame && !isInPlace) terminate()
    }
    const session: Session = {
      id,
      owner,
      kind,
      source,
      sourceEntityId,
      trigger,
      closed: false,
      files: new Map(),
      pending: new Set(),
      ...(kind === 'playback' && { playback: createPlaybackState() }),
      attach: () => {
        owner.webContents.removeListener('destroyed', terminate)
        owner.webContents.removeListener('render-process-gone', terminate)
        owner.webContents.removeListener('did-start-navigation', navigation)
        owner.webContents.once('destroyed', terminate)
        owner.webContents.on('render-process-gone', terminate)
        owner.webContents.on('did-start-navigation', navigation)
      },
      detach: () => {
        owner.webContents.removeListener('destroyed', terminate)
        owner.webContents.removeListener('render-process-gone', terminate)
        owner.webContents.removeListener('did-start-navigation', navigation)
      }
    }
    session.attach()
    this.sessions.set(id, session)
    return session
  }

  private acquireLease(session: Session): void {
    this.lease = session
    this.syncSleepHold()
  }

  private syncSleepHold(): void {
    const session = this.lease
    const working =
      session &&
      (this.active?.session === session ||
        (!session.closed && ['recording', 'recognizing', 'generating', 'playing'].includes(session.phase ?? '')))
    if (working) {
      this.sleepHold ??= application.get('PowerService').preventSleep(`voice:${session.kind}`)
    } else {
      this.sleepHold?.dispose()
      this.sleepHold = undefined
    }
  }

  private releaseLease(session?: Session): void {
    if (session && this.lease !== session) return
    const owner = this.lease?.owner
    this.lease = undefined
    this.syncSleepHold()
    if (this.voiceState.phase !== 'idle') this.publishState({ phase: 'idle', revision: ++this.revision }, owner)
  }

  private transition(session: Session, phase: ActivePhase, reason?: VoiceErrorReason): VoiceSessionState {
    session.phase = phase
    this.syncSleepHold()
    const state: VoiceSessionState = {
      phase,
      revision: ++this.revision,
      sessionId: session.id,
      ...(session.source && { source: session.source }),
      ...(session.trigger && { trigger: session.trigger }),
      ...(session.playback && {
        playback: createPlaybackSnapshot(
          session.playback,
          Boolean(session.outputId || (session.stream && !session.textInput))
        )
      }),
      ...(reason && { reason })
    }
    this.publishState(state)
    return { ...state }
  }

  private publishState(state: VoiceSessionState, owner = this.lease?.owner): void {
    this.voiceState = state
    const event = { type: 'state' as const, ...state }
    const ipc = application.get('IpcApiService')
    ipc.broadcastToType(WindowType.Main, 'ai.voice.session_event', event)
    ipc.broadcastToType(WindowType.SubWindow, 'ai.voice.session_event', event)
    const type = owner && application.get('WindowManager').getWindowType(owner.windowId)
    if (owner && !owner.webContents.isDestroyed() && type !== WindowType.Main && type !== WindowType.SubWindow) {
      ipc.send(owner.windowId, 'ai.voice.session_event', event)
    }
    logger.debug('Voice state changed', {
      sessionId: state.phase === 'idle' ? undefined : state.sessionId,
      operation: this.lease?.operation,
      state: state.phase,
      source: state.phase === 'idle' ? undefined : state.source,
      trigger: state.phase === 'idle' ? undefined : state.trigger,
      reason: state.phase === 'idle' ? undefined : state.reason,
      revision: state.revision
    })
  }

  private sendCommand(session: Session, command: VoiceSessionCommand): void {
    application.get('IpcApiService').send(session.owner.windowId, 'ai.voice.session_event', {
      type: 'command',
      sessionId: session.id,
      revision: this.revision,
      command,
      ...(session.playback && {
        playback: createPlaybackSnapshot(
          session.playback,
          Boolean(session.outputId || (session.stream && !session.textInput))
        )
      })
    })
  }

  private async consumeExecution<T>(session: Session, execution: VoiceExecution, result: Promise<T>): Promise<T> {
    session.execution = execution
    try {
      return await result
    } finally {
      await execution.closed
      if (session.execution === execution) session.execution = undefined
    }
  }

  private async run<T>(
    session: Session,
    requestId: string,
    modelId: LocalVoiceModelId,
    operation: VoiceOperation,
    work: (signal: AbortSignal) => Promise<T>,
    options: {
      startPhase?: ActivePhase
      failurePhase?: ActivePhase
      cleanupOnFailure?: boolean
      log?: Record<string, unknown>
    } = {}
  ): Promise<T> {
    this.requireAdmission()
    if (session.closed || (session.kind !== 'install' && this.lease !== session)) {
      throw new VoiceRuntimeError('aborted')
    }
    if (session.execution) throw new VoiceRuntimeError('operation_failed')
    if (this.active || this.inspections.size || session.pending.size) throw new VoiceRuntimeError('busy')
    if (session.requestId === requestId && session.operation !== undefined)
      throw new VoiceRuntimeError('invalid_request')
    const adapterId = getVoiceAdapterId(modelId)
    const controller = new AbortController()
    const active: ActiveOperation = { session, requestId, controller }
    this.active = active
    this.syncSleepHold()
    session.requestId = requestId
    session.selectedModel = modelId
    session.resolvedAdapter = adapterId
    session.operation = operation
    if (session.playback) {
      session.playback = beginPlaybackSynthesis(session.playback)
      this.publishPlayback(session)
    } else if (options.startPhase && session.phase !== 'paused') this.transition(session, options.startPhase)
    const startedAt = Date.now()
    logger.debug('Voice operation started', {
      sessionId: session.id,
      requestId,
      operation,
      state: session.phase,
      source: session.source,
      trigger: session.trigger,
      modelId,
      adapter: session.resolvedAdapter,
      ...options.log
    })
    const result = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted()
        const value = await work(controller.signal)
        controller.signal.throwIfAborted()
        session.terminalStatus = 'completed'
        return value
      } catch (error) {
        session.terminalStatus = controller.signal.aborted ? 'aborted' : 'failed'
        if (controller.signal.aborted || options.cleanupOnFailure) {
          for (const id of [...session.files.keys()]) await this.deleteFile(session, id)
          this.removeOutput(session)
        }
        const normalized = controller.signal.aborted
          ? new VoiceRuntimeError('aborted')
          : error instanceof VoiceRuntimeError
            ? error
            : new VoiceRuntimeError('operation_failed')
        if (!session.closed && session.playback) {
          session.playback = failPlayback(session.playback, 'synthesis', normalized.reason)
          this.clearPlaybackTimeout(session)
          this.publishPlayback(session)
        } else if (!session.closed && options.failurePhase)
          this.transition(session, options.failurePhase, normalized.reason)
        throw normalized
      } finally {
        if (this.active === active) this.active = undefined
        this.syncSleepHold()
        logger.debug('Voice operation settled', {
          sessionId: session.id,
          requestId,
          operation,
          state: session.phase,
          source: session.source,
          trigger: session.trigger,
          modelId,
          adapter: session.resolvedAdapter,
          status: session.terminalStatus,
          durationMs: Date.now() - startedAt,
          ...options.log
        })
      }
    })
    return this.track(session, result)
  }

  private async track<T>(session: Session, work: Promise<T>): Promise<T> {
    session.pending.add(work)
    try {
      return await work
    } finally {
      session.pending.delete(work)
      if (
        !session.pending.size &&
        !session.files.size &&
        !session.outputId &&
        this.active?.session !== session &&
        this.lease !== session
      ) {
        session.detach()
        this.sessions.delete(session.id)
      }
    }
  }

  private async createFile(session: Session, bytes: Uint8Array, ext: 'webm'): Promise<InternalFileEntry> {
    const files = application.get('FileManager')
    const entry = await files.createInternalEntry({
      source: 'bytes',
      data: bytes,
      name: 'voice',
      ext,
      cleanupPolicy: 'delete_when_unreferenced'
    })
    if (entry.origin !== 'internal') throw new VoiceRuntimeError('operation_failed')
    const reference = files.retainTemporaryEntry(entry.id)
    session.files.set(entry.id, { entry, reference })
    if (session.closed || !this.accepting || session.owner.webContents.isDestroyed()) {
      await this.deleteFile(session, entry.id)
      throw new VoiceRuntimeError('aborted')
    }
    return entry
  }

  private async deleteFile(session: Session, id: FileEntryId, releaseOnFailure = false): Promise<void> {
    const file = session.files.get(id)
    if (!file) return
    let deleted = false
    try {
      await application.get('FileManager').deleteRetainedTemporaryEntry(id)
      deleted = true
    } finally {
      if (deleted || releaseOnFailure) {
        file.reference.dispose()
        session.files.delete(id)
      }
    }
  }

  private closeSession(session: Session, terminal = false): Promise<void> {
    if (session.cleanup) {
      return terminal ? session.cleanup.catch(() => this.closeSession(session, true)) : session.cleanup
    }
    session.closed = true
    session.inputStream?.close()
    session.textInput?.close()
    session.stream?.close()
    this.clearPlaybackTimeout(session)
    this.removeOutput(session)
    this.syncSleepHold()
    session.detach()
    session.preflightAbort?.abort(new VoiceRuntimeError('aborted'))
    if (this.active?.session === session) this.active.controller.abort(new VoiceRuntimeError('aborted'))
    const execution = session.execution
    const cleanup = (async () => {
      try {
        if (execution) await execution.cancel()
        await Promise.allSettled(session.pending)
        for (const id of [...session.files.keys()]) {
          try {
            await this.deleteFile(session, id, terminal)
          } catch (error) {
            if (!terminal) throw error
            logger.warn('Voice terminal file cleanup failed', {
              sessionId: session.id,
              category: 'operation_failed',
              code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
            })
          }
        }
        this.sessions.delete(session.id)
        this.releaseLease(session)
      } catch (error) {
        session.cleanup = undefined
        if (!terminal) {
          session.attach()
          if (session.owner.webContents.isDestroyed()) {
            session.detach()
            void this.closeSession(session, true).catch(() =>
              logger.warn('Voice cleanup failed', { sessionId: session.id, category: 'operation_failed' })
            )
          }
        }
        throw error
      }
    })()
    session.cleanup = cleanup
    return cleanup
  }

  private resolveAdmittedSpeech(session: Session, input: InputFor<'ai.speech.generate'>) {
    const controller = new AbortController()
    session.preflightAbort = controller
    const powerEpoch = this.powerEpoch
    const configuration = this.track(
      session,
      resolveSpeechConfiguration(
        {
          ...(input.modelId && { modelId: input.modelId }),
          ...(input.voice && { voice: input.voice }),
          language: input.language,
          speed: input.speed
        },
        controller.signal
      )
    )
    return configuration
      .catch((error: unknown) => {
        if (controller.signal.aborted || session.closed || powerEpoch !== this.powerEpoch) {
          throw new VoiceRuntimeError('aborted')
        }
        throw error
      })
      .finally(() => {
        if (session.preflightAbort === controller) session.preflightAbort = undefined
      })
  }

  private async abandonUnstartedPlayback(session: Session, requestId: string): Promise<void> {
    if (session.closed || this.lease !== session || session.requestId !== requestId || session.outputId) return
    if (session.operation) return
    await this.closeSession(session, true)
  }

  private async inspect<T>(owner: VoiceOwner, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.requireAdmission()
    this.requireOwner(owner)
    if (this.active) throw new VoiceRuntimeError('busy')
    const controller = new AbortController()
    const terminate = () => controller.abort(new VoiceRuntimeError('aborted'))
    const navigation = (...args: unknown[]) => {
      const details = args[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined
      const isMainFrame = details?.isMainFrame ?? (args[3] as boolean | undefined)
      const isInPlace = details?.isSameDocument ?? (args[2] as boolean | undefined)
      if (isMainFrame && !isInPlace) terminate()
    }
    owner.webContents.once('destroyed', terminate)
    owner.webContents.on('render-process-gone', terminate)
    owner.webContents.on('did-start-navigation', navigation)
    const promise = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted()
      const result = await work(controller.signal)
      controller.signal.throwIfAborted()
      return result
    })
    this.inspections.set(promise, controller)
    try {
      return await promise
    } finally {
      owner.webContents.removeListener('destroyed', terminate)
      owner.webContents.removeListener('render-process-gone', terminate)
      owner.webContents.removeListener('did-start-navigation', navigation)
      this.inspections.delete(promise)
    }
  }

  private installMicrophonePermissionHandlers(): void {
    const check = (
      webContents: WebContents | null,
      permission: string,
      _requestingOrigin: string,
      details: Electron.PermissionCheckHandlerHandlerDetails
    ) => {
      if (permission === 'media') {
        return (
          details.mediaType === 'audio' &&
          this.canDiscoverMicrophones(webContents, permission, details.requestingUrl, details.isMainFrame)
        )
      }
      return this.canUseNonMediaPermission(webContents, permission, details.requestingUrl, details.isMainFrame)
    }
    const request = (
      webContents: WebContents,
      permission: string,
      callback: (allowed: boolean) => void,
      details: Electron.PermissionRequest | Electron.MediaAccessPermissionRequest
    ) => {
      if (permission === 'media') {
        const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
        callback(this.canUseMicrophone(webContents, permission, details.requestingUrl, details.isMainFrame, mediaTypes))
        return
      }
      callback(this.canUseNonMediaPermission(webContents, permission, details.requestingUrl, details.isMainFrame))
    }
    electronSession.defaultSession.setPermissionCheckHandler(check)
    electronSession.defaultSession.setPermissionRequestHandler(request)
    this.registerDisposable(() => {
      electronSession.defaultSession.setPermissionCheckHandler(null)
      electronSession.defaultSession.setPermissionRequestHandler(null)
    })
  }

  private canUseNonMediaPermission(
    webContents: WebContents | null,
    permission: string,
    requestingUrl: string | undefined,
    isMainFrame: boolean
  ): boolean {
    // Electron's default check grants every permission except this deprecated sync read.
    if (permission === 'deprecated-sync-clipboard-read') return false
    return this.isTrustedLiveAppMainFrame(webContents, requestingUrl, isMainFrame)
  }

  private isTrustedLiveAppMainFrame(
    webContents: WebContents | null,
    requestingUrl: string | undefined,
    isMainFrame: boolean
  ): boolean {
    if (!this.accepting || !webContents || webContents.isDestroyed()) return false
    if (!isMainFrame || !requestingUrl || !isAppRendererUrl(requestingUrl)) return false
    const windows = application.get('WindowManager')
    const windowId = windows.getWindowIdByWebContents(webContents)
    const managed = windowId ? windows.getWindow(windowId) : undefined
    return Boolean(managed && !managed.isDestroyed() && managed.webContents === webContents)
  }

  private canDiscoverMicrophones(
    webContents: WebContents | null,
    permission: string,
    requestingUrl: string | undefined,
    isMainFrame: boolean
  ): boolean {
    if (permission !== 'media') return false
    return this.isTrustedLiveAppMainFrame(webContents, requestingUrl, isMainFrame)
  }

  private canUseMicrophone(
    webContents: WebContents | null,
    permission: string,
    requestingUrl: string | undefined,
    isMainFrame: boolean,
    mediaTypes?: readonly string[]
  ): boolean {
    if (mediaTypes?.length !== 1 || mediaTypes[0] !== 'audio') return false
    if (!this.canDiscoverMicrophones(webContents, permission, requestingUrl, isMainFrame)) return false
    const lease = this.lease
    return Boolean(
      lease &&
      !lease.closed &&
      lease.kind === 'recording' &&
      lease.phase === 'recording' &&
      lease.owner.webContents === webContents
    )
  }

  private handlePowerInterruption(): void {
    this.powerEpoch += 1
    const event = { type: 'interruption' as const, revision: ++this.revision }
    const ipc = application.get('IpcApiService')
    for (const type of [WindowType.Main, WindowType.SubWindow, WindowType.QuickAssistant, WindowType.SelectionAction]) {
      ipc.broadcastToType(type, 'ai.voice.session_event', event)
    }
    const session = this.lease
    if (!session || session.closed) return
    if (session.preflightAbort) {
      session.preflightAbort.abort(new VoiceRuntimeError('aborted'))
      return
    }
    if (session.phase === 'paused') return
    if (session.kind === 'recording') {
      this.sendCommand(session, 'interrupt')
      return
    }
    if (session.kind === 'playback' && session.phase !== 'failed') {
      void this.controlPlayback(session.owner, { sessionId: session.id, command: 'pause' }).catch(() => undefined)
    }
  }
}
