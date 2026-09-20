import type { WebContents } from 'electron'
import { session as electronSession, shell, systemPreferences } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isAppRendererUrl } from '@main/core/security/validateSender'
import { WindowType } from '@main/core/window/types'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  DEFAULT_SPEECH_SPEED,
  LOCAL_VOICE_MODELS,
  type LocalVoiceModelId,
  resolveDefaultAsrModel,
  type VoiceSessionSource,
  type VoiceSessionTrigger
} from '@shared/ai/localVoice'
import type { FileEntryId, InternalFileEntry } from '@shared/data/types/file'
import type { VoiceSessionCommand, VoiceSessionPhase, VoiceSessionState } from '@shared/ipc/schemas/voice'
import type { InputFor } from '@shared/ipc/types'

import { getLocalVoiceStatus, installAppleAsrAsset, listLocalVoices, voiceAudioProcess } from './localAdapters'
import { VoiceRuntimeError } from './VoiceRuntimeError'

const logger = loggerService.withContext('VoiceSessionService')
const MICROPHONE_SETTINGS = {
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  win32: 'ms-settings:privacy-microphone'
} as const

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
  trigger?: VoiceSessionTrigger
  phase?: ActivePhase
  closed: boolean
  files: Map<FileEntryId, SessionFile>
  pending: Set<Promise<unknown>>
  attach: () => void
  detach: () => void
  requestId?: string
  operation?: VoiceOperation
  selectedModel?: LocalVoiceModelId
  resolvedAdapter?: 'apple' | 'funasr'
  terminalStatus?: 'completed' | 'failed' | 'aborted'
  cleanup?: Promise<void>
  outputId?: FileEntryId
  chunkCount?: number
  currentChunkIndex?: number
  nextChunkIndex?: number
  generatedUnchunked?: boolean
  outputAccess?: Promise<unknown>
}
type ActiveOperation = { session: Session; requestId: string; controller: AbortController }

@Injectable('VoiceSessionService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService', 'FileManager', 'WindowManager', 'UtilityProcessManager', 'PowerService'])
export class VoiceSessionService extends BaseService {
  private accepting = false
  private readonly sessions = new Map<string, Session>()
  private active?: ActiveOperation
  private lease?: Session
  private sleepHold?: Disposable
  private revision = 0
  private voiceState: VoiceSessionState = { phase: 'idle', revision: 0 }
  private readonly inspections = new Map<Promise<unknown>, AbortController>()

  protected override onInit(): void {
    application.get('UtilityProcessManager').register(voiceAudioProcess)
    this.accepting = true
    this.installMicrophonePermissionHandlers()
    const power = application.get('PowerService')
    this.registerDisposable(power.onSuspend(() => void this.handlePowerInterruption('suspend')))
    this.registerDisposable(power.onLockScreen(() => void this.handlePowerInterruption('lock')))
    this.registerDisposable(() => {
      for (const session of this.sessions.values()) session.detach()
    })
  }

  protected override async onStop(): Promise<void> {
    this.accepting = false
    for (const controller of this.inspections.values()) controller.abort(new VoiceRuntimeError('aborted'))
    const cleanup = [...this.sessions.values()].map((session) => this.closeSession(session, true))
    await Promise.allSettled([...cleanup, ...this.inspections.keys()])
    this.releaseLease()
  }

  protected override async onDestroy(): Promise<void> {
    await this.onStop()
  }

  getState(owner: VoiceOwner): VoiceSessionState {
    this.requireAdmission()
    this.requireOwner(owner)
    return { ...this.voiceState }
  }

  listModels() {
    this.requireAdmission()
    return { models: LOCAL_VOICE_MODELS, defaultAsrModelId: this.defaultAsrModel() }
  }

  status(owner: VoiceOwner, input: InputFor<'ai.voice.model.status'>) {
    return this.inspect(owner, (signal) => getLocalVoiceStatus(input.modelId, input, signal))
  }

  voices(owner: VoiceOwner) {
    return this.inspect(owner, async (signal) =>
      (await listLocalVoices(signal)).map(({ id, name, locale }) => ({ id, name, language: locale }))
    )
  }

  async startRecording(owner: VoiceOwner, input: InputFor<'ai.voice.recording.start'>): Promise<VoiceSessionState> {
    this.requireAdmission()
    this.requireOwner(owner)
    if (this.inspections.size) {
      for (const controller of this.inspections.values()) controller.abort(new VoiceRuntimeError('aborted'))
      await Promise.allSettled(this.inspections.keys())
    }
    while (this.lease || this.active) {
      const displaced = this.lease ?? this.active!.session
      if (this.lease === displaced && !displaced.closed) this.sendCommand(displaced, 'stop')
      await this.closeSession(displaced, true)
    }
    const session = this.createSession(owner, input.sessionId, 'recording', input.source)
    session.requestId = input.requestId
    this.acquireLease(session)
    return this.transition(session, 'recording')
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

  async transcribe(owner: VoiceOwner, input: InputFor<'ai.transcription.generate'>) {
    if (this.active || this.inspections.size) throw new VoiceRuntimeError('busy')
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'recording' || !['recorded', 'failed'].includes(session.phase ?? ''))
      throw new VoiceRuntimeError('invalid_request')
    if (!session.files.has(input.fileEntryId)) throw new VoiceRuntimeError('forbidden_owner')
    const modelId = input.modelId ?? this.defaultAsrModel()
    if (!modelId) throw new VoiceRuntimeError('unsupported')
    const result = await this.run(
      session,
      input.requestId,
      modelId,
      'transcription',
      async (signal) => {
        await this.requireReady(modelId, input, signal)
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
        const transcript = await application
          .get('AiService')
          .transcribe(modelId, audio.content, { language: input.language }, signal)
        signal.throwIfAborted()
        await this.deleteFile(session, input.fileEntryId)
        return { sessionId: session.id, requestId: input.requestId, ...transcript }
      },
      {
        startPhase: 'recognizing',
        failurePhase: 'failed',
        log: { locale: input.language, mimeType: 'audio/webm;codecs=opus' }
      }
    )
    await this.closeSession(session)
    return result
  }

  async speech(owner: VoiceOwner, input: InputFor<'ai.speech.generate'>) {
    const trigger = input.trigger ?? 'manual'
    const session = await this.preparePlayback(owner, input, trigger)
    const modelId = input.modelId ?? APPLE_TTS_MODEL_ID
    const normalizedText = input.text.normalize('NFC').trim()
    return this.run(
      session,
      input.requestId,
      modelId,
      'speech',
      async (signal) => {
        await this.requireReady(modelId, input, signal)
        const result = await application
          .get('AiService')
          .generateSpeech(
            modelId,
            normalizedText,
            { voice: input.voice, language: input.language, speed: input.speed ?? DEFAULT_SPEECH_SPEED },
            signal
          )
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
        const fileEntry = await this.createFile(session, wav, 'wav')
        session.outputId = fileEntry.id
        session.currentChunkIndex = input.chunkIndex
        if (input.chunkIndex === undefined) session.generatedUnchunked = true
        signal.throwIfAborted()
        this.transition(session, 'ready')
        return { sessionId: session.id, requestId: input.requestId, fileEntry, mimeType: 'audio/wav' as const }
      },
      {
        startPhase: 'generating',
        failurePhase: 'failed',
        cleanupOnFailure: true,
        log: {
          locale: input.language,
          normalizedTextLength: normalizedText.length,
          chunkIndex: input.chunkIndex,
          chunkCount: input.chunkCount
        }
      }
    )
  }

  async readOutput(owner: VoiceOwner, input: InputFor<'ai.voice.output.read'>) {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'playback' || session.outputId !== input.fileEntryId) {
      throw new VoiceRuntimeError('forbidden_owner')
    }
    const file = session.files.get(input.fileEntryId)
    if (!file || file.entry.ext !== 'wav') throw new VoiceRuntimeError('forbidden_owner')
    return this.withOutputAccess(session, async () => {
      const output = await application.get('FileManager').read(input.fileEntryId, { encoding: 'binary' })
      if (session.closed) throw new VoiceRuntimeError('aborted')
      if (output.mime !== 'audio/wav') throw new VoiceRuntimeError('invalid_audio')
      return { audio: Uint8Array.from(output.content), mimeType: 'audio/wav' as const }
    })
  }

  async releaseOutput(owner: VoiceOwner, input: InputFor<'ai.voice.output.release'>): Promise<void> {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'playback' || session.outputId !== input.fileEntryId) {
      throw new VoiceRuntimeError('forbidden_owner')
    }
    await this.withOutputAccess(session, async () => {
      await this.deleteFile(session, input.fileEntryId)
      session.outputId = undefined
      if (session.currentChunkIndex !== undefined) session.nextChunkIndex = session.currentChunkIndex + 1
      session.currentChunkIndex = undefined
    })
  }

  async updatePlayback(owner: VoiceOwner, input: InputFor<'ai.voice.playback.update'>): Promise<VoiceSessionState> {
    const session = this.requireLeaseSession(owner, input.sessionId)
    if (session.kind !== 'playback') throw new VoiceRuntimeError('invalid_request')
    switch (input.phase) {
      case 'playing':
        if (
          !['ready', 'paused'].includes(session.phase ?? '') &&
          !(session.phase === 'failed' && session.outputId && session.files.has(session.outputId))
        )
          throw new VoiceRuntimeError('invalid_request')
        return this.transition(session, 'playing')
      case 'paused':
        if (!['ready', 'playing'].includes(session.phase ?? '')) throw new VoiceRuntimeError('invalid_request')
        return this.transition(session, 'paused')
      case 'failed':
        return this.transition(session, 'failed', input.reason ?? 'operation_failed')
      case 'completed':
        await this.closeSession(session)
        return { ...this.voiceState }
    }
  }

  async controlPlayback(owner: VoiceOwner, input: InputFor<'ai.voice.playback.control'>): Promise<VoiceSessionState> {
    this.requireControlOwner(owner)
    const session = this.lease
    if (!session || session.id !== input.sessionId || session.kind !== 'playback') {
      throw new VoiceRuntimeError('invalid_request')
    }
    switch (input.command) {
      case 'pause':
        if (!['ready', 'playing'].includes(session.phase ?? '')) throw new VoiceRuntimeError('invalid_request')
        this.sendCommand(session, 'pause')
        return this.transition(session, 'paused')
      case 'resume':
        if (session.phase !== 'paused') throw new VoiceRuntimeError('invalid_request')
        this.sendCommand(session, 'resume')
        return this.transition(session, 'playing')
      case 'stop':
        this.sendCommand(session, 'stop')
        await this.closeSession(session, true)
        return { ...this.voiceState }
    }
  }

  getMicrophoneStatus(owner: VoiceOwner): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' {
    this.requireAdmission()
    this.requireOwner(owner)
    if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown'
    try {
      return systemPreferences.getMediaAccessStatus('microphone')
    } catch {
      return 'unknown'
    }
  }

  async openMicrophoneSettings(owner: VoiceOwner): Promise<void> {
    this.requireAdmission()
    this.requireOwner(owner)
    const url = MICROPHONE_SETTINGS[process.platform as keyof typeof MICROPHONE_SETTINGS]
    if (!url) throw new VoiceRuntimeError('unsupported')
    await shell.openExternal(url)
  }

  async installAsset(owner: VoiceOwner, input: InputFor<'ai.transcription.asset.install'>): Promise<void> {
    if (this.active || this.inspections.size || this.lease) throw new VoiceRuntimeError('busy')
    const session = this.createSession(owner, input.sessionId, 'install', input.source)
    await this.run(
      session,
      input.requestId,
      APPLE_ASR_MODEL_ID,
      'install',
      async (signal) => {
        await installAppleAsrAsset(input.language, signal)
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
    if (
      this.active?.session !== session ||
      this.active.requestId !== input.requestId ||
      session.operation !== expectedOperation
    )
      return
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
    if (this.inspections.size) throw new VoiceRuntimeError('busy')
    if (this.lease?.kind === 'playback' && this.lease.id === input.sessionId && !this.active) {
      const session = this.lease
      this.assertOwner(session, owner)
      if (session.files.size || session.pending.size || session.outputId) throw new VoiceRuntimeError('busy')
      this.validateNextChunk(session, input, trigger)
      return session
    }
    if (trigger === 'auto_read' && (this.lease || this.active)) throw new VoiceRuntimeError('busy')

    while (this.lease || this.active) {
      const occupied = this.lease ?? this.active!.session
      if (trigger !== 'manual' || occupied.kind !== 'playback' || this.lease !== occupied) {
        throw new VoiceRuntimeError('busy')
      }
      if (!occupied.closed) this.sendCommand(occupied, 'stop')
      await this.closeSession(occupied, true)
    }

    if (input.chunkIndex !== undefined && input.chunkIndex !== 0) throw new VoiceRuntimeError('invalid_request')
    const session = this.createSession(owner, input.sessionId, 'playback', input.source, trigger)
    session.requestId = input.requestId
    session.chunkCount = input.chunkCount
    this.acquireLease(session)
    return session
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
      session.trigger !== trigger
    ) {
      throw new VoiceRuntimeError('invalid_request')
    }
  }

  private defaultAsrModel() {
    return resolveDefaultAsrModel({
      platform: process.platform,
      majorVersion: process.platform === 'darwin' ? Number.parseInt(process.getSystemVersion(), 10) : undefined
    })
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
    const type = application.get('WindowManager').getWindowType(owner.windowId)
    if (type !== WindowType.Main && type !== WindowType.SubWindow) throw new VoiceRuntimeError('forbidden_owner')
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
      trigger,
      closed: false,
      files: new Map(),
      pending: new Set(),
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
    this.sleepHold = application.get('PowerService').preventSleep(`voice:${session.kind}`)
  }

  private releaseLease(session?: Session): void {
    if (session && this.lease !== session) return
    this.lease = undefined
    this.sleepHold?.dispose()
    this.sleepHold = undefined
    if (this.voiceState.phase !== 'idle') this.publishState({ phase: 'idle', revision: ++this.revision })
  }

  private transition(
    session: Session,
    phase: ActivePhase,
    reason?: InputFor<'ai.voice.playback.update'>['reason']
  ): VoiceSessionState {
    session.phase = phase
    const state: VoiceSessionState = {
      phase,
      revision: ++this.revision,
      sessionId: session.id,
      ...(session.source && { source: session.source }),
      ...(session.trigger && { trigger: session.trigger }),
      ...(reason && { reason })
    }
    this.publishState(state)
    return { ...state }
  }

  private publishState(state: VoiceSessionState): void {
    this.voiceState = state
    const event = { type: 'state' as const, ...state }
    const ipc = application.get('IpcApiService')
    ipc.broadcastToType(WindowType.Main, 'ai.voice.session_event', event)
    ipc.broadcastToType(WindowType.SubWindow, 'ai.voice.session_event', event)
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
      revision: this.voiceState.revision,
      command
    })
  }

  private async requireReady(
    modelId: LocalVoiceModelId,
    options: { language?: string; voice?: string },
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted()
    const resource = await getLocalVoiceStatus(modelId, options, signal)
    signal.throwIfAborted()
    if (resource.status !== 'ready') throw new VoiceRuntimeError(resource.reason ?? 'operation_failed')
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
    if (this.active || this.inspections.size || session.pending.size) throw new VoiceRuntimeError('busy')
    if (session.requestId === requestId && session.operation !== undefined)
      throw new VoiceRuntimeError('invalid_request')
    const controller = new AbortController()
    const active: ActiveOperation = { session, requestId, controller }
    this.active = active
    session.requestId = requestId
    session.selectedModel = modelId
    session.resolvedAdapter = modelId === 'local-voice::funasr-nano' ? 'funasr' : 'apple'
    session.operation = operation
    if (options.startPhase) this.transition(session, options.startPhase)
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
          session.outputId = undefined
        }
        const normalized = controller.signal.aborted
          ? new VoiceRuntimeError('aborted')
          : error instanceof VoiceRuntimeError
            ? error
            : new VoiceRuntimeError('operation_failed')
        if (!session.closed && options.failurePhase) this.transition(session, options.failurePhase, normalized.reason)
        throw normalized
      } finally {
        if (this.active === active) this.active = undefined
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
      if (!session.pending.size && !session.files.size && this.active?.session !== session && this.lease !== session) {
        session.detach()
        this.sessions.delete(session.id)
      }
    }
  }

  private async withOutputAccess<T>(session: Session, work: () => Promise<T>): Promise<T> {
    if (session.outputAccess) throw new VoiceRuntimeError('busy')
    const operation = Promise.resolve().then(work)
    session.outputAccess = operation
    try {
      return await this.track(session, operation)
    } finally {
      if (session.outputAccess === operation) session.outputAccess = undefined
    }
  }

  private async createFile(session: Session, bytes: Uint8Array, ext: 'webm' | 'wav'): Promise<InternalFileEntry> {
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
    session.detach()
    if (this.active?.session === session) this.active.controller.abort(new VoiceRuntimeError('aborted'))
    const cleanup = (async () => {
      try {
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

  private async inspect<T>(owner: VoiceOwner, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.requireAdmission()
    this.requireOwner(owner)
    if (this.active || this.inspections.size) throw new VoiceRuntimeError('busy')
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
    ) => this.canUseMicrophone(webContents, permission, details.requestingUrl, details.isMainFrame, details.mediaType)
    const request = (
      webContents: WebContents,
      permission: string,
      callback: (allowed: boolean) => void,
      details: Electron.PermissionRequest | Electron.MediaAccessPermissionRequest
    ) => {
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
      callback(
        this.canUseMicrophone(
          webContents,
          permission,
          details.requestingUrl,
          details.isMainFrame,
          undefined,
          mediaTypes
        )
      )
    }
    electronSession.defaultSession.setPermissionCheckHandler(check)
    electronSession.defaultSession.setPermissionRequestHandler(request)
    this.registerDisposable(() => {
      electronSession.defaultSession.setPermissionCheckHandler(null)
      electronSession.defaultSession.setPermissionRequestHandler(null)
    })
  }

  private canUseMicrophone(
    webContents: WebContents | null,
    permission: string,
    requestingUrl: string | undefined,
    isMainFrame: boolean,
    mediaType?: string,
    mediaTypes?: readonly string[]
  ): boolean {
    if (!this.accepting || permission !== 'media' || !webContents || !requestingUrl || !isMainFrame) return false
    const audioOnly = mediaTypes ? mediaTypes.length === 1 && mediaTypes[0] === 'audio' : mediaType === 'audio'
    if (!audioOnly) return false
    const lease = this.lease
    if (
      !lease ||
      lease.closed ||
      lease.kind !== 'recording' ||
      lease.phase !== 'recording' ||
      lease.owner.webContents !== webContents
    ) {
      return false
    }
    const managed = application.get('WindowManager').getWindow(lease.owner.windowId)
    return Boolean(
      managed && !managed.isDestroyed() && managed.webContents === webContents && isAppRendererUrl(requestingUrl)
    )
  }

  private async handlePowerInterruption(kind: 'suspend' | 'lock'): Promise<void> {
    const session = this.lease
    if (!session || session.closed || session.phase === 'paused') return
    if (session.kind === 'playback' && session.phase === 'playing') {
      this.sendCommand(session, 'pause')
      this.transition(session, 'paused')
      return
    }
    this.sendCommand(session, 'stop')
    try {
      await this.closeSession(session, true)
    } catch {
      logger.warn('Voice power cleanup failed', {
        sessionId: session.id,
        operation: session.operation,
        state: session.phase,
        reason: 'operation_failed',
        powerEvent: kind
      })
    }
  }
}
