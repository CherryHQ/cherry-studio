import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { voiceErrorCodes, type VoiceErrorReason } from '@shared/ipc/errors/voice'
import type { voiceRequestSchemas, VoiceSessionEvent, VoiceSessionState } from '@shared/ipc/schemas/voice'
import type { EventPayload, InputFor, OutputFor } from '@shared/ipc/types'

type VoiceRoute = keyof typeof voiceRequestSchemas
export type VoiceCommandEvent = Extract<VoiceSessionEvent, { type: 'command' }>
type VoiceStateEvent = Extract<VoiceSessionEvent, { type: 'state' }>

interface VoiceIpc {
  request<R extends VoiceRoute>(
    route: R,
    ...args: InputFor<R> extends void ? [] : [input: InputFor<R>]
  ): Promise<OutputFor<R>>
  on(event: 'ai.voice.session_event', callback: (payload: EventPayload<'ai.voice.session_event'>) => void): () => void
}

interface VoiceServiceOptions {
  ipc?: VoiceIpc
  ownerWindow?: Window
  createId?: () => string
}

export interface VoiceOperation<T> {
  readonly sessionId: string
  readonly requestId: string
  readonly result: Promise<T>
}

export type StartRecordingInput = Omit<InputFor<'ai.voice.recording.start'>, 'sessionId' | 'requestId'> & {
  sessionId?: string
  requestId?: string
}

export type CreateRecordingInput = Omit<InputFor<'file.voice_recording.create'>, 'mimeType'>

export type TranscriptionInput = Omit<InputFor<'ai.transcription.generate'>, 'requestId'> & {
  requestId?: string
}

export type SpeechInput = Omit<InputFor<'ai.speech.generate'>, 'sessionId' | 'requestId'> & {
  sessionId?: string
  requestId?: string
}

export type InstallTranscriptionAssetInput = Omit<
  InputFor<'ai.transcription.asset.install'>,
  'sessionId' | 'requestId'
> & {
  sessionId?: string
  requestId?: string
}

const reasonByCode = new Map<string, VoiceErrorReason>(
  Object.entries(voiceErrorCodes).map(([reason, code]) => [code, reason as VoiceErrorReason])
)

export class VoiceDomainError extends Error {
  constructor(readonly reason: VoiceErrorReason) {
    super(reason)
    this.name = 'VoiceDomainError'
  }
}

function toVoiceDomainError(error: unknown): VoiceDomainError {
  if (error instanceof VoiceDomainError) return error
  if (error instanceof IpcError) return new VoiceDomainError(reasonByCode.get(error.code) ?? 'operation_failed')
  return new VoiceDomainError('operation_failed')
}

export class VoiceService {
  private readonly ipc: VoiceIpc
  private readonly ownerWindow: Window
  private readonly createId: () => string
  private readonly stateListeners = new Set<() => void>()
  private readonly commandListeners = new Set<(event: VoiceCommandEvent) => void>()
  private readonly pendingAdmissions = new Map<string, number>()
  private readonly ownedSessionIds = new Set<string>()
  private snapshot: VoiceSessionState = { phase: 'idle', revision: 0 }
  private initialization?: Promise<void>
  private unsubscribeEvent?: () => void
  private currentOwnedSessionId?: string
  private eventsActive = false

  constructor(options: VoiceServiceOptions = {}) {
    this.ipc = options.ipc ?? ipcApi
    this.ownerWindow = options.ownerWindow ?? window
    this.createId = options.createId ?? (() => crypto.randomUUID())
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization

    try {
      this.eventsActive = true
      this.unsubscribeEvent = this.ipc.on('ai.voice.session_event', this.handleEvent)
      this.ownerWindow.addEventListener('beforeunload', this.handleBeforeUnload)
    } catch (error) {
      this.eventsActive = false
      return Promise.reject(toVoiceDomainError(error))
    }

    const initialization = this.invoke(() => this.ipc.request('ai.voice.session.state'))
      .then((state) => {
        this.applyState(state)
      })
      .catch((error: unknown) => {
        this.detach()
        this.initialization = undefined
        throw error
      })
    this.initialization = initialization
    return initialization
  }

  subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  getSnapshot = (): VoiceSessionState => this.snapshot

  subscribeCommands = (listener: (event: VoiceCommandEvent) => void): (() => void) => {
    this.commandListeners.add(listener)
    return () => this.commandListeners.delete(listener)
  }

  listModels(): Promise<OutputFor<'ai.voice.models.list'>> {
    return this.invoke(() => this.ipc.request('ai.voice.models.list'))
  }

  getModelStatus(input: InputFor<'ai.voice.model.status'>): Promise<OutputFor<'ai.voice.model.status'>> {
    return this.invoke(() => this.ipc.request('ai.voice.model.status', input))
  }

  listVoices(): Promise<OutputFor<'ai.speech.voices.list'>> {
    return this.invoke(() => this.ipc.request('ai.speech.voices.list'))
  }

  installTranscriptionAsset(
    input: InstallTranscriptionAssetInput
  ): VoiceOperation<OutputFor<'ai.transcription.asset.install'>> {
    const { sessionId = this.createId(), requestId = this.createId(), ...payload } = input
    this.ownedSessionIds.add(sessionId)
    return {
      sessionId,
      requestId,
      result: this.invoke(() =>
        this.ipc.request('ai.transcription.asset.install', { sessionId, requestId, ...payload })
      ).finally(() => {
        if (this.currentOwnedSessionId !== sessionId && !this.pendingAdmissions.has(sessionId)) {
          this.ownedSessionIds.delete(sessionId)
        }
      })
    }
  }

  getMicrophoneStatus(): Promise<OutputFor<'ai.voice.microphone.status'>> {
    return this.invoke(() => this.ipc.request('ai.voice.microphone.status'))
  }

  openMicrophoneSettings(): Promise<void> {
    return this.invoke(() => this.ipc.request('ai.voice.microphone.open_settings'))
  }

  startRecording(input: StartRecordingInput = {}): VoiceOperation<OutputFor<'ai.voice.recording.start'>> {
    const { sessionId = this.createId(), requestId = this.createId(), ...payload } = input
    this.beginAdmission(sessionId)
    const result = this.invoke(() =>
      this.ipc.request('ai.voice.recording.start', { sessionId, requestId, ...payload })
    ).then(
      (state) => {
        this.applyState(state)
        if (this.pendingAdmissions.has(sessionId)) this.releasePendingAdmission(sessionId)
        return state
      },
      (error: unknown) => {
        this.releasePendingAdmission(sessionId)
        throw error
      }
    )
    return { sessionId, requestId, result }
  }

  createRecording(input: CreateRecordingInput): Promise<OutputFor<'file.voice_recording.create'>> {
    return this.invoke(() =>
      this.ipc.request('file.voice_recording.create', { ...input, mimeType: 'audio/webm;codecs=opus' })
    )
  }

  transcribe(input: TranscriptionInput): VoiceOperation<OutputFor<'ai.transcription.generate'>> {
    const { requestId = this.createId(), ...payload } = input
    return {
      sessionId: input.sessionId,
      requestId,
      result: this.invoke(() => this.ipc.request('ai.transcription.generate', { ...payload, requestId }))
    }
  }

  retryTranscription(input: TranscriptionInput): VoiceOperation<OutputFor<'ai.transcription.generate'>> {
    return this.transcribe(input)
  }

  abortTranscription(operation: Pick<VoiceOperation<unknown>, 'sessionId' | 'requestId'>): Promise<void> {
    const { sessionId, requestId } = operation
    return this.invoke(() => this.ipc.request('ai.transcription.abort', { sessionId, requestId }))
  }

  generateSpeech(input: SpeechInput): VoiceOperation<OutputFor<'ai.speech.generate'>> {
    const { sessionId = this.createId(), requestId = this.createId(), ...payload } = input
    const admissionRevision = this.beginAdmission(sessionId)
    return {
      sessionId,
      requestId,
      result: this.invoke(() => this.ipc.request('ai.speech.generate', { sessionId, requestId, ...payload })).then(
        (result) => {
          if (this.pendingAdmissions.get(sessionId) === admissionRevision) {
            if (this.snapshot.revision === admissionRevision) this.promoteAdmission(sessionId)
            else this.releasePendingAdmission(sessionId)
          }
          return result
        },
        (error: unknown) => {
          this.releasePendingAdmission(sessionId)
          throw error
        }
      )
    }
  }

  abortSpeech(operation: Pick<VoiceOperation<unknown>, 'sessionId' | 'requestId'>): Promise<void> {
    const { sessionId, requestId } = operation
    return this.invoke(() => this.ipc.request('ai.speech.abort', { sessionId, requestId }))
  }

  readOutput(input: InputFor<'ai.voice.output.read'>): Promise<OutputFor<'ai.voice.output.read'>> {
    return this.invoke(() => this.ipc.request('ai.voice.output.read', input))
  }

  releaseOutput(input: InputFor<'ai.voice.output.release'>): Promise<void> {
    return this.invoke(() => this.ipc.request('ai.voice.output.release', input))
  }

  updatePlayback(input: InputFor<'ai.voice.playback.update'>): Promise<OutputFor<'ai.voice.playback.update'>> {
    return this.invoke(() => this.ipc.request('ai.voice.playback.update', input)).then((state) => {
      this.applyState(state)
      return state
    })
  }

  controlPlayback(input: InputFor<'ai.voice.playback.control'>): Promise<OutputFor<'ai.voice.playback.control'>> {
    return this.invoke(() => this.ipc.request('ai.voice.playback.control', input)).then((state) => {
      this.applyState(state)
      return state
    })
  }

  async discardSession(sessionId: string): Promise<void> {
    await this.invoke(() => this.ipc.request('ai.voice.session.discard', { sessionId }))
    this.releaseOwnedSession(sessionId)
  }

  async teardown(): Promise<void> {
    const sessionIds = this.beginTeardown()
    const results = await Promise.allSettled(
      sessionIds.map((sessionId) => this.invoke(() => this.ipc.request('ai.voice.session.discard', { sessionId })))
    )
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  private readonly handleEvent = (event: VoiceSessionEvent): void => {
    if (!this.eventsActive) return
    if (event.type === 'state') {
      this.applyState(event)
      return
    }
    if (event.revision < this.snapshot.revision || event.sessionId !== this.currentOwnedSessionId) return
    if (this.snapshot.phase === 'idle' || this.snapshot.sessionId !== event.sessionId) return
    this.commandListeners.forEach((listener) => listener(event))
  }

  private readonly handleBeforeUnload = (): void => {
    const sessionIds = this.beginTeardown()
    void Promise.all(
      sessionIds.map((sessionId) => this.invoke(() => this.ipc.request('ai.voice.session.discard', { sessionId })))
    ).catch(() => undefined)
  }

  private applyState(state: VoiceSessionState | VoiceStateEvent): boolean {
    if (state.revision <= this.snapshot.revision) return false
    if (!('type' in state)) {
      this.snapshot = state
    } else if (state.phase === 'idle') {
      this.snapshot = { phase: 'idle', revision: state.revision }
    } else {
      this.snapshot = {
        phase: state.phase,
        revision: state.revision,
        sessionId: state.sessionId,
        ...(state.source && { source: state.source }),
        ...(state.trigger && { trigger: state.trigger }),
        ...(state.reason && { reason: state.reason })
      }
    }
    this.reconcileOwnership(this.snapshot)
    this.stateListeners.forEach((listener) => listener())
    return true
  }

  private detach(): void {
    this.eventsActive = false
    this.unsubscribeEvent?.()
    this.unsubscribeEvent = undefined
    this.ownerWindow.removeEventListener('beforeunload', this.handleBeforeUnload)
  }

  private beginAdmission(sessionId: string): number {
    if (this.currentOwnedSessionId !== sessionId) {
      this.pendingAdmissions.set(sessionId, this.snapshot.revision)
      this.ownedSessionIds.add(sessionId)
    }
    return this.snapshot.revision
  }

  private promoteAdmission(sessionId: string): void {
    if (!this.pendingAdmissions.has(sessionId)) return
    const previous = this.currentOwnedSessionId
    if (previous && previous !== sessionId) this.ownedSessionIds.delete(previous)
    this.pendingAdmissions.delete(sessionId)
    this.currentOwnedSessionId = sessionId
    this.ownedSessionIds.add(sessionId)
  }

  private releasePendingAdmission(sessionId: string): void {
    if (!this.pendingAdmissions.delete(sessionId)) return
    if (this.currentOwnedSessionId !== sessionId) this.ownedSessionIds.delete(sessionId)
  }

  private releaseOwnedSession(sessionId: string): void {
    this.pendingAdmissions.delete(sessionId)
    this.ownedSessionIds.delete(sessionId)
    if (this.currentOwnedSessionId === sessionId) this.currentOwnedSessionId = undefined
  }

  private reconcileOwnership(state: VoiceSessionState): void {
    if (state.phase === 'idle') {
      if (this.currentOwnedSessionId) this.releaseOwnedSession(this.currentOwnedSessionId)
      return
    }
    if (this.pendingAdmissions.has(state.sessionId)) {
      this.promoteAdmission(state.sessionId)
      return
    }
    if (this.currentOwnedSessionId && this.currentOwnedSessionId !== state.sessionId) {
      this.releaseOwnedSession(this.currentOwnedSessionId)
    }
  }

  private beginTeardown(): string[] {
    this.detach()
    this.initialization = undefined
    this.stateListeners.clear()
    this.commandListeners.clear()
    const sessionIds = [...this.ownedSessionIds]
    this.pendingAdmissions.clear()
    this.ownedSessionIds.clear()
    this.currentOwnedSessionId = undefined
    return sessionIds
  }

  private invoke<T>(operation: () => Promise<T>): Promise<T> {
    return Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        throw toVoiceDomainError(error)
      })
  }
}

export const voiceService = new VoiceService()
