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

type SessionReservationKind = 'install' | 'recording' | 'speech'

interface SessionReservation {
  readonly token: symbol
  readonly generation: number
  readonly kind: SessionReservationKind
}

interface PendingAdmission extends SessionReservation {
  readonly revision: number
}

interface SpeechSequence {
  readonly reservationToken: symbol
  readonly chunkCount?: number
  nextChunkIndex?: number
  outputFileEntryId?: string
  activeSpeechToken?: symbol
  activeReleaseToken?: symbol
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
  private readonly reservations = new Map<string, SessionReservation>()
  private readonly tombstones = new Map<string, symbol>()
  private readonly pendingAdmissions = new Map<string, PendingAdmission>()
  private readonly speechSequences = new Map<string, SpeechSequence>()
  private snapshot: VoiceSessionState = { phase: 'idle', revision: 0 }
  private initialization?: { generation: number; promise: Promise<void> }
  private unsubscribeEvent?: () => void
  private subscriptionGeneration?: number
  private currentOwnedSessionId?: string
  private lifecycleGeneration = 0

  constructor(options: VoiceServiceOptions = {}) {
    this.ipc = options.ipc ?? ipcApi
    this.ownerWindow = options.ownerWindow ?? window
    this.createId = options.createId ?? (() => crypto.randomUUID())
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization.promise

    const generation = this.lifecycleGeneration

    try {
      this.subscriptionGeneration = generation
      this.unsubscribeEvent = this.ipc.on('ai.voice.session_event', (event) => this.handleEvent(generation, event))
      this.ownerWindow.addEventListener('beforeunload', this.handleBeforeUnload)
    } catch (error) {
      this.detach(generation)
      return Promise.reject(toVoiceDomainError(error))
    }

    const initialization = this.invoke(() => this.ipc.request('ai.voice.session.state'))
      .then((state) => {
        if (generation === this.lifecycleGeneration && this.subscriptionGeneration === generation) {
          this.applyState(state)
        }
      })
      .catch((error: unknown) => {
        this.detach(generation)
        if (this.initialization?.generation === generation) this.initialization = undefined
        throw error
      })
    this.initialization = { generation, promise: initialization }
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
    const reservation = this.reserveSession(sessionId, 'install')
    if (!reservation) return this.rejectedOperation(sessionId, requestId, 'busy')
    return {
      sessionId,
      requestId,
      result: this.invoke(() =>
        this.ipc.request('ai.transcription.asset.install', { sessionId, requestId, ...payload })
      ).finally(() => {
        this.releaseTombstone(sessionId, reservation.token)
        this.releaseReservation(sessionId, reservation.token)
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
    const admission = this.beginAdmission(sessionId, 'recording')
    if (!admission) return this.rejectedOperation(sessionId, requestId, 'busy')
    const result = this.invoke(() =>
      this.ipc.request('ai.voice.recording.start', { sessionId, requestId, ...payload })
    ).then(
      async (state) => {
        if (!this.isReservationCurrent(sessionId, admission)) {
          await this.discardMaterialized(sessionId)
          this.releaseTombstone(sessionId, admission.token)
          throw new VoiceDomainError('aborted')
        }
        this.applyState(state)
        if (this.pendingAdmissions.get(sessionId)?.token === admission.token) {
          if (this.snapshot.revision === admission.revision) this.promoteAdmission(sessionId, admission.token)
          else this.releasePendingAdmission(sessionId, admission.token)
        }
        return state
      },
      (error: unknown) => {
        if (admission.generation !== this.lifecycleGeneration) {
          this.releaseTombstone(sessionId, admission.token)
          throw new VoiceDomainError('aborted')
        }
        this.releasePendingAdmission(sessionId, admission.token)
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
    const prepared = this.prepareSpeech(sessionId, input)
    if (!prepared) return this.rejectedOperation(sessionId, requestId, 'busy')
    const { admission, reservation, sequence, speechToken } = prepared
    return {
      sessionId,
      requestId,
      result: this.invoke(() => this.ipc.request('ai.speech.generate', { sessionId, requestId, ...payload })).then(
        async (result) => {
          if (!this.isReservationCurrent(sessionId, reservation)) {
            await this.discardMaterialized(sessionId)
            this.releaseTombstone(sessionId, reservation.token)
            throw new VoiceDomainError('aborted')
          }
          sequence.activeSpeechToken = undefined
          sequence.outputFileEntryId = result.fileEntry.id
          if (admission && this.pendingAdmissions.get(sessionId)?.token === admission.token) {
            if (this.snapshot.revision === admission.revision) this.promoteAdmission(sessionId, admission.token)
            else this.releasePendingAdmission(sessionId, admission.token)
          }
          return result
        },
        (error: unknown) => {
          if (sequence.activeSpeechToken === speechToken) sequence.activeSpeechToken = undefined
          if (reservation.generation !== this.lifecycleGeneration) {
            this.releaseTombstone(sessionId, reservation.token)
            throw new VoiceDomainError('aborted')
          }
          if (admission) this.releasePendingAdmission(sessionId, admission.token)
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
    const reservation = this.reservations.get(input.sessionId)
    const sequence = this.speechSequences.get(input.sessionId)
    if (
      !reservation ||
      reservation.kind !== 'speech' ||
      this.currentOwnedSessionId !== input.sessionId ||
      sequence?.reservationToken !== reservation.token ||
      sequence.outputFileEntryId !== input.fileEntryId ||
      sequence.activeReleaseToken
    ) {
      return Promise.reject(new VoiceDomainError('busy'))
    }
    const releaseToken = Symbol(input.sessionId)
    sequence.activeReleaseToken = releaseToken
    return this.invoke(() => this.ipc.request('ai.voice.output.release', input)).then(
      () => {
        if (reservation.generation !== this.lifecycleGeneration) {
          this.releaseTombstone(input.sessionId, reservation.token)
          throw new VoiceDomainError('aborted')
        }
        if (this.isReservationCurrent(input.sessionId, reservation) && sequence.activeReleaseToken === releaseToken) {
          sequence.activeReleaseToken = undefined
          sequence.outputFileEntryId = undefined
          if (sequence.nextChunkIndex !== undefined) sequence.nextChunkIndex += 1
        }
      },
      (error: unknown) => {
        if (sequence.activeReleaseToken === releaseToken) sequence.activeReleaseToken = undefined
        if (reservation.generation !== this.lifecycleGeneration) {
          this.releaseTombstone(input.sessionId, reservation.token)
          throw new VoiceDomainError('aborted')
        }
        throw error
      }
    )
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
    const reservation = this.reservations.get(sessionId)
    await this.invoke(() => this.ipc.request('ai.voice.session.discard', { sessionId }))
    if (reservation) this.releaseOwnedSession(sessionId, reservation.token)
  }

  async teardown(): Promise<void> {
    const sessionIds = this.beginTeardown()
    const results = await Promise.allSettled(
      sessionIds.map((sessionId) => this.invoke(() => this.ipc.request('ai.voice.session.discard', { sessionId })))
    )
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  private handleEvent(generation: number, event: VoiceSessionEvent): void {
    if (generation !== this.lifecycleGeneration || this.subscriptionGeneration !== generation) return
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

  private detach(generation?: number): void {
    if (generation !== undefined && this.subscriptionGeneration !== generation) return
    this.unsubscribeEvent?.()
    this.unsubscribeEvent = undefined
    this.subscriptionGeneration = undefined
    this.ownerWindow.removeEventListener('beforeunload', this.handleBeforeUnload)
  }

  private reserveSession(sessionId: string, kind: SessionReservationKind): SessionReservation | undefined {
    if (this.reservations.has(sessionId) || this.tombstones.has(sessionId)) return undefined
    const reservation = { token: Symbol(sessionId), generation: this.lifecycleGeneration, kind }
    this.reservations.set(sessionId, reservation)
    return reservation
  }

  private beginAdmission(sessionId: string, kind: 'recording' | 'speech'): PendingAdmission | undefined {
    const reservation = this.reserveSession(sessionId, kind)
    if (!reservation) return undefined
    const admission = { ...reservation, revision: this.snapshot.revision }
    this.pendingAdmissions.set(sessionId, admission)
    return admission
  }

  private promoteAdmission(sessionId: string, token: symbol): void {
    if (this.pendingAdmissions.get(sessionId)?.token !== token) return
    const previous = this.currentOwnedSessionId
    if (previous && previous !== sessionId) {
      const previousReservation = this.reservations.get(previous)
      if (previousReservation) this.releaseOwnedSession(previous, previousReservation.token)
    }
    this.pendingAdmissions.delete(sessionId)
    this.currentOwnedSessionId = sessionId
  }

  private releasePendingAdmission(sessionId: string, token: symbol): void {
    if (this.pendingAdmissions.get(sessionId)?.token !== token) return
    this.pendingAdmissions.delete(sessionId)
    if (this.currentOwnedSessionId !== sessionId) this.releaseReservation(sessionId, token)
  }

  private releaseOwnedSession(sessionId: string, token: symbol): void {
    if (this.reservations.get(sessionId)?.token !== token) return
    if (this.pendingAdmissions.get(sessionId)?.token === token) this.pendingAdmissions.delete(sessionId)
    this.releaseReservation(sessionId, token)
    if (this.currentOwnedSessionId === sessionId) this.currentOwnedSessionId = undefined
  }

  private releaseReservation(sessionId: string, token: symbol): void {
    if (this.reservations.get(sessionId)?.token !== token) return
    this.reservations.delete(sessionId)
    if (this.speechSequences.get(sessionId)?.reservationToken === token) this.speechSequences.delete(sessionId)
  }

  private releaseTombstone(sessionId: string, token: symbol): void {
    if (this.tombstones.get(sessionId) === token) this.tombstones.delete(sessionId)
  }

  private isReservationCurrent(sessionId: string, reservation: SessionReservation): boolean {
    return (
      reservation.generation === this.lifecycleGeneration &&
      this.reservations.get(sessionId)?.token === reservation.token
    )
  }

  private reconcileOwnership(state: VoiceSessionState): void {
    if (state.phase === 'idle') {
      if (this.currentOwnedSessionId) {
        const reservation = this.reservations.get(this.currentOwnedSessionId)
        if (reservation) this.releaseOwnedSession(this.currentOwnedSessionId, reservation.token)
      }
      return
    }
    const admission = this.pendingAdmissions.get(state.sessionId)
    if (admission) {
      this.promoteAdmission(state.sessionId, admission.token)
      return
    }
    if (this.currentOwnedSessionId && this.currentOwnedSessionId !== state.sessionId) {
      const reservation = this.reservations.get(this.currentOwnedSessionId)
      if (reservation) this.releaseOwnedSession(this.currentOwnedSessionId, reservation.token)
    }
  }

  private beginTeardown(): string[] {
    this.detach()
    this.lifecycleGeneration += 1
    this.initialization = undefined
    this.stateListeners.clear()
    this.commandListeners.clear()
    const sessionIds = [...this.reservations.keys()]
    this.reservations.forEach((reservation, sessionId) => {
      const sequence = this.speechSequences.get(sessionId)
      if (
        reservation.kind === 'install' ||
        this.pendingAdmissions.get(sessionId)?.token === reservation.token ||
        sequence?.activeSpeechToken ||
        sequence?.activeReleaseToken
      ) {
        this.tombstones.set(sessionId, reservation.token)
      }
    })
    this.pendingAdmissions.clear()
    this.reservations.clear()
    this.speechSequences.clear()
    this.currentOwnedSessionId = undefined
    return sessionIds
  }

  private prepareSpeech(
    sessionId: string,
    input: SpeechInput
  ):
    | {
        admission?: PendingAdmission
        reservation: SessionReservation
        sequence: SpeechSequence
        speechToken: symbol
      }
    | undefined {
    let admission: PendingAdmission | undefined
    let reservation = this.reservations.get(sessionId)
    let sequence = this.speechSequences.get(sessionId)

    if (this.currentOwnedSessionId === sessionId) {
      if (
        !reservation ||
        reservation.kind !== 'speech' ||
        !sequence ||
        sequence.reservationToken !== reservation.token ||
        sequence.activeSpeechToken ||
        sequence.activeReleaseToken ||
        sequence.outputFileEntryId ||
        input.chunkIndex === undefined ||
        input.chunkCount === undefined ||
        input.chunkCount !== sequence.chunkCount ||
        input.chunkIndex !== sequence.nextChunkIndex
      ) {
        return undefined
      }
    } else {
      if (input.chunkIndex !== undefined && input.chunkIndex !== 0) return undefined
      admission = this.beginAdmission(sessionId, 'speech')
      if (!admission) return undefined
      reservation = admission
      sequence = {
        reservationToken: admission.token,
        chunkCount: input.chunkCount,
        nextChunkIndex: input.chunkIndex
      }
      this.speechSequences.set(sessionId, sequence)
    }

    const speechToken = Symbol(sessionId)
    sequence.activeSpeechToken = speechToken
    return { admission, reservation, sequence, speechToken }
  }

  private async discardMaterialized(sessionId: string): Promise<void> {
    await this.invoke(() => this.ipc.request('ai.voice.session.discard', { sessionId })).catch(() => undefined)
  }

  private rejectedOperation<T>(sessionId: string, requestId: string, reason: VoiceErrorReason): VoiceOperation<T> {
    return { sessionId, requestId, result: Promise.reject(new VoiceDomainError(reason)) }
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
