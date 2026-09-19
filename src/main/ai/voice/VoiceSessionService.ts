import type { WebContents } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  LOCAL_VOICE_MODELS,
  type LocalVoiceModelId,
  resolveDefaultAsrModel
} from '@shared/ai/localVoice'
import type { FileEntryId, InternalFileEntry } from '@shared/data/types/file'
import type { InputFor } from '@shared/ipc/types'

import { getLocalVoiceStatus, installAppleAsrAsset, listLocalVoices, voiceAudioProcess } from './localAdapters'
import { VoiceRuntimeError } from './VoiceRuntimeError'

const logger = loggerService.withContext('VoiceSessionService')

export interface VoiceOwner {
  windowId: string
  webContents: Pick<WebContents, 'id' | 'isDestroyed' | 'once' | 'removeListener'>
}

type SessionFile = { entry: InternalFileEntry; reference: Disposable }
type VoiceOperation = 'speech' | 'transcription' | 'install'
type Session = {
  id: string
  owner: VoiceOwner
  closed: boolean
  files: Map<FileEntryId, SessionFile>
  pending: Set<Promise<unknown>>
  detach: () => void
  requestId?: string
  operation?: VoiceOperation
  selectedModel?: LocalVoiceModelId
  resolvedAdapter?: 'apple' | 'funasr'
  terminalStatus?: 'completed' | 'failed' | 'aborted'
  cleanup?: Promise<void>
}
type ActiveOperation = { session: Session; requestId: string; controller: AbortController }

@Injectable('VoiceSessionService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService', 'FileManager', 'WindowManager', 'UtilityProcessManager'])
export class VoiceSessionService extends BaseService {
  private accepting = false
  private readonly sessions = new Map<string, Session>()
  private active?: ActiveOperation
  private readonly inspections = new Map<Promise<unknown>, AbortController>()

  protected override onInit(): void {
    application.get('UtilityProcessManager').register(voiceAudioProcess)
    this.accepting = true
    this.registerDisposable(() => {
      for (const session of this.sessions.values()) session.detach()
    })
  }

  protected override async onStop(): Promise<void> {
    this.accepting = false
    for (const controller of this.inspections.values()) controller.abort(new VoiceRuntimeError('aborted'))
    const cleanup = [...this.sessions.values()].map((session) => this.closeSession(session))
    await Promise.allSettled([...cleanup, ...this.inspections.keys()])
  }

  protected override async onDestroy(): Promise<void> {
    await this.onStop()
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
    const session = this.sessionFor(owner, input.sessionId)
    if (session.files.size || session.pending.size || this.active?.session === session)
      throw new VoiceRuntimeError('busy')
    const work = this.createFile(session, input.audio, 'webm')
    return this.track(session, work)
  }

  async transcribe(owner: VoiceOwner, input: InputFor<'ai.transcription.generate'>) {
    if (this.active || this.inspections.size) throw new VoiceRuntimeError('busy')
    const session = this.sessionFor(owner, input.sessionId, false)
    if (!session.files.has(input.fileEntryId)) throw new VoiceRuntimeError('forbidden_owner')
    const modelId = input.modelId ?? this.defaultAsrModel()
    if (!modelId) throw new VoiceRuntimeError('unsupported')
    return this.run(session, input.requestId, modelId, 'transcription', async (signal) => {
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
      const result = await application
        .get('AiService')
        .transcribe(modelId, audio.content, { language: input.language }, signal)
      signal.throwIfAborted()
      await this.deleteFile(session, input.fileEntryId)
      return { sessionId: session.id, requestId: input.requestId, ...result }
    })
  }

  async speech(owner: VoiceOwner, input: InputFor<'ai.speech.generate'>) {
    if (this.active || this.inspections.size) throw new VoiceRuntimeError('busy')
    const session = this.sessionFor(owner, input.sessionId)
    if (session.files.size) throw new VoiceRuntimeError('busy')
    const modelId = input.modelId ?? APPLE_TTS_MODEL_ID
    return this.run(session, input.requestId, modelId, 'speech', async (signal) => {
      await this.requireReady(modelId, input, signal)
      const result = await application
        .get('AiService')
        .generateSpeech(
          modelId,
          input.text.normalize('NFC').trim(),
          { voice: input.voice, language: input.language },
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
      signal.throwIfAborted()
      return { sessionId: session.id, requestId: input.requestId, fileEntry, mimeType: 'audio/wav' as const }
    })
  }

  async installAsset(owner: VoiceOwner, input: InputFor<'ai.transcription.asset.install'>): Promise<void> {
    if (this.active || this.inspections.size) throw new VoiceRuntimeError('busy')
    const session = this.sessionFor(owner, input.sessionId)
    await this.run(session, input.requestId, APPLE_ASR_MODEL_ID, 'install', async (signal) => {
      await installAppleAsrAsset(input.language, signal)
    })
  }

  async abort(owner: VoiceOwner, input: InputFor<'ai.speech.abort'>): Promise<void> {
    this.requireOwner(owner)
    const session = this.sessions.get(input.sessionId)
    if (!session) return
    this.assertOwner(session, owner)
    if (this.active?.session === session && this.active.requestId !== input.requestId) return
    if (session.requestId && session.requestId !== input.requestId) return
    await this.closeSession(session)
  }

  async discard(owner: VoiceOwner, sessionId: string): Promise<void> {
    this.requireOwner(owner)
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.assertOwner(session, owner)
    await this.closeSession(session)
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
  }
  private assertOwner(session: Session, owner: VoiceOwner): void {
    if (session.owner.windowId !== owner.windowId || session.owner.webContents !== owner.webContents)
      throw new VoiceRuntimeError('forbidden_owner')
  }

  private sessionFor(owner: VoiceOwner, id: string, create = true): Session {
    this.requireAdmission()
    this.requireOwner(owner)
    const existing = this.sessions.get(id)
    if (existing) {
      this.assertOwner(existing, owner)
      if (existing.closed) throw new VoiceRuntimeError('aborted')
      return existing
    }
    if (!create) throw new VoiceRuntimeError('forbidden_owner')
    if (this.sessions.size >= 16) throw new VoiceRuntimeError('busy')
    const destroyed = () => {
      void this.closeSession(session).catch(() =>
        logger.warn('Voice cleanup failed', { sessionId: id, category: 'operation_failed' })
      )
    }
    const session: Session = {
      id,
      owner,
      closed: false,
      files: new Map(),
      pending: new Set(),
      detach: () => owner.webContents.removeListener('destroyed', destroyed)
    }
    owner.webContents.once('destroyed', destroyed)
    this.sessions.set(id, session)
    return session
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
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    this.requireAdmission()
    if (this.active || this.inspections.size || session.pending.size) throw new VoiceRuntimeError('busy')
    if (session.requestId === requestId) throw new VoiceRuntimeError('invalid_request')
    const controller = new AbortController()
    const active: ActiveOperation = { session, requestId, controller }
    this.active = active
    session.requestId = requestId
    session.selectedModel = modelId
    session.resolvedAdapter = modelId === 'local-voice::funasr-nano' ? 'funasr' : 'apple'
    session.operation = operation
    const startedAt = Date.now()
    const result = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted()
        const value = await work(controller.signal)
        controller.signal.throwIfAborted()
        session.terminalStatus = 'completed'
        return value
      } catch (error) {
        session.terminalStatus = controller.signal.aborted ? 'aborted' : 'failed'
        if (controller.signal.aborted || operation === 'speech') {
          for (const id of session.files.keys()) await this.deleteFile(session, id)
        }
        throw controller.signal.aborted
          ? new VoiceRuntimeError('aborted')
          : error instanceof VoiceRuntimeError
            ? error
            : new VoiceRuntimeError('operation_failed')
      } finally {
        if (this.active === active) this.active = undefined
        logger.debug('Voice operation settled', {
          sessionId: session.id,
          requestId,
          modelId,
          status: session.terminalStatus,
          durationMs: Date.now() - startedAt
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
      if (!session.pending.size && !session.files.size && this.active?.session !== session) {
        session.detach()
        this.sessions.delete(session.id)
      }
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
    if (session.closed || !this.accepting || session.owner.webContents.isDestroyed()) {
      await files.permanentDelete(entry.id)
      throw new VoiceRuntimeError('aborted')
    }
    session.files.set(entry.id, { entry, reference: files.retainTemporaryEntry(entry.id) })
    return entry
  }

  private async deleteFile(session: Session, id: FileEntryId): Promise<void> {
    const file = session.files.get(id)
    if (!file) return
    await application.get('FileManager').permanentDelete(id)
    file.reference.dispose()
    session.files.delete(id)
  }

  private closeSession(session: Session): Promise<void> {
    if (session.cleanup) return session.cleanup
    session.closed = true
    session.detach()
    if (this.active?.session === session) this.active.controller.abort(new VoiceRuntimeError('aborted'))
    const cleanup = (async () => {
      try {
        await Promise.allSettled(session.pending)
        for (const id of session.files.keys()) await this.deleteFile(session, id)
        this.sessions.delete(session.id)
      } catch (error) {
        session.cleanup = undefined
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
    const destroyed = () => controller.abort(new VoiceRuntimeError('aborted'))
    owner.webContents.once('destroyed', destroyed)
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
      owner.webContents.removeListener('destroyed', destroyed)
      this.inspections.delete(promise)
    }
  }
}
