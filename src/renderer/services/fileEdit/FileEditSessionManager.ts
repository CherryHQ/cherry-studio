import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { decodeFileText, encodeFileText, type DecodedFileText } from '@renderer/utils/fileTextSnapshot'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { FileEditBaseline, FileEditResource } from '@shared/ipc/schemas/fileEdit'

const logger = loggerService.withContext('FileEditSessionManager')

export interface SessionSnapshot {
  readonly sessionId: string
  readonly ownerId: string
  readonly locator: string
  readonly readError?: Error
  readonly draft: string
  readonly savedContent: string
  readonly savedSizeBytes: number
  readonly revision: number
  readonly documentEpoch: number
  readonly bindingEpoch: number
  readonly isDirty: boolean
  readonly isSaving: boolean
  readonly conflict: boolean
  readonly saveError?: Error
  readonly metadataRecoveryPending: boolean
  readonly freshness: 'known' | 'unknown'
  readonly sealed: boolean
}

interface DiskSnapshot extends DecodedFileText {
  baseline: FileEditBaseline
}
interface Session {
  resource: FileEditResource
  key: string
  disk: DiskSnapshot
  snapshot: SessionSnapshot
  listeners: Set<() => void>
  attachments: Set<symbol>
  binding?: symbol
  queue: Promise<void>
  pending: number
  timer?: ReturnType<typeof setTimeout>
  readGeneration: number
  transition: boolean
  needsRevalidation: boolean
}

export interface SessionLease {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  readonly writable: boolean
  acceptEdit(text: string, documentEpoch?: number, bindingEpoch?: number): boolean
  flush(): Promise<void>
  discard(): Promise<void>
  reload(): Promise<void>
  keepLocal(): Promise<void>
  invalidate(): Promise<void>
  release(): void
}

export interface PreparedFileMutation {
  finish(): Promise<void>
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

class AcquisitionInterruptedError extends Error {}

export class FileEditSessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly acquisitions = new Map<string, Promise<Session>>()
  private acquisitionEpoch = 0
  private mutationSettled?: Promise<void>
  private composing = false
  private readonly inventoryListeners = new Set<() => void>()
  private inventory: readonly SessionSnapshot[] = []
  readonly subscribe = (listener: () => void) => {
    this.inventoryListeners.add(listener)
    return () => {
      this.inventoryListeners.delete(listener)
    }
  }
  readonly getSnapshot = () => this.inventory

  setComposing(value: boolean): void {
    this.composing = value
  }
  private publishInventory(): void {
    this.inventory = [...this.sessions.values()]
      .filter((session) => !session.attachments.size && (session.snapshot.isDirty || !!session.snapshot.saveError))
      .map((session) => session.snapshot)
    for (const listener of this.inventoryListeners) listener()
  }
  async recover(sessionId: string, action: 'retry' | 'discard'): Promise<void> {
    const session = [...this.sessions.values()].find((candidate) => candidate.snapshot.sessionId === sessionId)
    if (!session || session.attachments.size) return
    if (action === 'discard') await this.replace(session, 'discard')
    else await this.flush(session)
  }

  async prepareMutation(): Promise<PreparedFileMutation> {
    if (this.composing || this.mutationSettled) throw new Error('File editing is not ready for a transition')
    const affected = [...this.sessions.values()]
    if (affected.some((session) => session.transition)) throw new Error('A file transition is already running')
    const settlement = Promise.withResolvers<void>()
    this.mutationSettled = settlement.promise
    this.acquisitionEpoch++
    for (const session of affected) {
      session.transition = true
      session.readGeneration++
      this.cancelTimer(session)
      this.publish(session, { sealed: true })
    }
    const unseal = () => {
      for (const session of affected) {
        session.transition = false
        this.publish(session, { sealed: false })
        this.evict(session)
      }
      this.mutationSettled = undefined
      settlement.resolve()
    }
    // Sessions already parked in conflict/error keep their draft for recovery; they must not block other files.
    const flushable = affected.filter((session) => !session.snapshot.conflict && !session.snapshot.saveError)
    const results = await Promise.allSettled(flushable.map((session) => this.flush(session)))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      unseal()
      throw failure.reason
    }
    await Promise.all(affected.map((session) => session.queue))
    let finishing: Promise<void> | undefined
    return {
      finish: () => {
        finishing ??= (async () => {
          try {
            await Promise.all(
              affected.filter((session) => session.attachments.size).map((session) => this.invalidate(session, true))
            )
          } finally {
            unseal()
          }
        })()
        return finishing
      }
    }
  }

  async acquire(ownerId: string, handle: FileHandle): Promise<SessionLease> {
    const locator = handle.kind === 'path' ? handle.path : handle.entryId
    const key = JSON.stringify([ownerId, handle.kind, locator])
    for (;;) {
      while (this.mutationSettled) await this.mutationSettled
      const epoch = this.acquisitionEpoch
      const retained = this.sessions.get(key)
      if (retained) {
        const lease = this.attach(retained)
        void this.invalidate(retained)
        return lease
      }
      let opening = this.acquisitions.get(key)
      if (!opening) {
        opening = this.open(key, ownerId, locator, handle, epoch)
        this.acquisitions.set(key, opening)
      }
      try {
        const session = await opening
        if (this.mutationSettled || epoch !== this.acquisitionEpoch) continue
        return this.attach(session)
      } catch (error) {
        if (!(error instanceof AcquisitionInterruptedError)) throw error
      } finally {
        if (this.acquisitions.get(key) === opening) this.acquisitions.delete(key)
      }
    }
  }

  listRetained(): readonly SessionSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot)
  }

  private async open(
    key: string,
    ownerId: string,
    locator: string,
    handle: FileHandle,
    epoch: number
  ): Promise<Session> {
    const resource = await ipcApi.request('file.edit.open', { handle })
    try {
      if (this.mutationSettled || epoch !== this.acquisitionEpoch) throw new AcquisitionInterruptedError()
      const disk = await this.read(resource)
      if (this.mutationSettled || epoch !== this.acquisitionEpoch) throw new AcquisitionInterruptedError()
      const session: Session = {
        key,
        resource,
        disk,
        listeners: new Set(),
        attachments: new Set(),
        queue: Promise.resolve(),
        pending: 0,
        readGeneration: 0,
        transition: false,
        needsRevalidation: false,
        snapshot: {
          sessionId: crypto.randomUUID(),
          ownerId,
          locator,
          draft: disk.content,
          savedContent: disk.content,
          savedSizeBytes: disk.baseline.version.size,
          revision: 0,
          documentEpoch: 1,
          bindingEpoch: 0,
          isDirty: false,
          isSaving: false,
          conflict: false,
          metadataRecoveryPending: false,
          freshness: 'known',
          sealed: false
        }
      }
      this.sessions.set(key, session)
      return session
    } catch (error) {
      await ipcApi
        .request('file.edit.close', { editId: resource.editId })
        .catch((closeError) => logger.error('Edit lease cleanup failed', asError(closeError)))
      throw error
    }
  }

  private attach(session: Session): SessionLease {
    const attachment = Symbol('file attachment')
    session.attachments.add(attachment)
    this.publishInventory()
    session.binding = attachment
    this.publish(session, { bindingEpoch: session.snapshot.bindingEpoch + 1 })
    let released = false
    const current = () => !released && session.binding === attachment && !session.snapshot.sealed
    const command = (run: () => Promise<void>) => {
      if (!current()) return Promise.reject(new Error('File editor binding is no longer writable'))
      return run()
    }
    return {
      getSnapshot: () => session.snapshot,
      subscribe: (listener) => {
        session.listeners.add(listener)
        return () => {
          session.listeners.delete(listener)
        }
      },
      get writable() {
        return !released && session.binding === attachment
      },
      acceptEdit: (
        text,
        documentEpoch = session.snapshot.documentEpoch,
        bindingEpoch = session.snapshot.bindingEpoch
      ) => {
        if (
          !current() ||
          !!session.snapshot.readError ||
          documentEpoch !== session.snapshot.documentEpoch ||
          bindingEpoch !== session.snapshot.bindingEpoch
        )
          return false
        const draft = text.replace(/\r\n?/g, '\n')
        if (draft === session.snapshot.draft) return true
        this.publish(session, { draft, revision: session.snapshot.revision + 1 })
        this.schedule(session)
        return true
      },
      flush: () => command(() => this.flush(session)),
      discard: () => command(() => this.replace(session, 'discard')),
      reload: () => command(() => this.replace(session, 'reload')),
      keepLocal: () => command(() => this.replace(session, 'keep')),
      invalidate: () => this.invalidate(session),
      release: () => {
        if (released) return
        released = true
        session.attachments.delete(attachment)
        this.publishInventory()
        if (session.binding === attachment) {
          session.binding = undefined
          this.cancelTimer(session)
          if (session.snapshot.isDirty && !session.snapshot.saveError && !session.snapshot.conflict)
            void this.flush(session).catch(() => {})
        }
        this.evict(session)
      }
    }
  }

  private publish(session: Session, patch: Partial<SessionSnapshot>): void {
    const bindingEpoch =
      patch.sealed !== undefined && patch.sealed !== session.snapshot.sealed
        ? session.snapshot.bindingEpoch + 1
        : (patch.bindingEpoch ?? session.snapshot.bindingEpoch)
    session.snapshot = { ...session.snapshot, ...patch, bindingEpoch }
    session.snapshot = { ...session.snapshot, isDirty: session.snapshot.draft !== session.disk.content }
    for (const listener of session.listeners) listener()
    this.publishInventory()
  }

  private async read(resource: FileEditResource): Promise<DiskSnapshot> {
    const result = await ipcApi.request('file.edit.read', { editId: resource.editId })
    return { ...decodeFileText(result.data), baseline: result.baseline }
  }

  private adoptBaseline(session: Session, disk: DiskSnapshot): void {
    session.disk = disk
    session.readGeneration++
    this.publish(session, {
      savedContent: disk.content,
      savedSizeBytes: disk.baseline.version.size,
      freshness: 'known'
    })
  }

  private cancelTimer(session: Session): void {
    clearTimeout(session.timer)
    session.timer = undefined
  }

  private schedule(session: Session): void {
    this.cancelTimer(session)
    if (session.snapshot.saveError || session.snapshot.conflict || session.snapshot.sealed) return
    session.timer = setTimeout(() => {
      void this.flush(session).catch(() => {})
    }, 800)
  }

  private enqueue(session: Session, run: () => Promise<void>): Promise<void> {
    session.readGeneration++
    session.pending++
    this.publish(session, { isSaving: true })
    const task = session.queue.then(run)
    session.queue = task
      .catch(() => {})
      .then(() => {
        session.pending--
        this.publish(session, { isSaving: session.pending > 0 })
        this.evict(session)
        if (
          !session.pending &&
          session.needsRevalidation &&
          !session.snapshot.sealed &&
          this.sessions.get(session.key) === session
        )
          void this.invalidate(session)
      })
    return task
  }

  private flush(session: Session): Promise<void> {
    this.cancelTimer(session)
    const { draft } = session.snapshot
    const resource = session.resource
    return this.enqueue(session, async () => {
      try {
        if (session.snapshot.conflict) throw new IpcError(fileErrorCodes.STALE_VERSION, 'File has external changes')
        await this.save(session, draft, resource)
        this.publish(session, { saveError: undefined })
        if (session.snapshot.isDirty && session.pending === 1) this.schedule(session)
      } catch (error) {
        this.publish(session, { saveError: asError(error) })
        throw error
      }
    })
  }

  private async save(session: Session, text: string, resource = session.resource): Promise<void> {
    for (let retries = 0; retries < 4; retries++) {
      if (text === session.disk.content) return
      const disk = session.disk
      try {
        const result = await ipcApi.request('file.edit.write', {
          editId: resource.editId,
          expected: disk.baseline,
          data: encodeFileText(text, disk.lineEnding, disk.hasBom)
        })
        this.adoptBaseline(session, { ...disk, content: text, baseline: result.baseline })
        this.publish(session, { metadataRecoveryPending: result.metadataRecoveryPending, saveError: undefined })
        return
      } catch (error) {
        if (!(error instanceof IpcError) || error.code !== fileErrorCodes.STALE_VERSION) throw error
      }
      const current = await this.read(resource)
      if (current.content === text || current.baseline.contentHash === disk.baseline.contentHash) {
        this.adoptBaseline(session, current)
        continue
      }
      this.publish(session, { conflict: true })
      throw new IpcError(fileErrorCodes.STALE_VERSION, 'File has external changes')
    }
    throw new IpcError(fileErrorCodes.STALE_VERSION, 'File changed repeatedly during save')
  }

  private replace(session: Session, mode: 'discard' | 'reload' | 'keep'): Promise<void> {
    if (session.transition) return Promise.reject(new Error('File transition is already running'))
    session.transition = true
    this.cancelTimer(session)
    this.publish(session, { sealed: true })
    const { draft, revision } = session.snapshot
    return this.enqueue(session, async () => {
      try {
        if (mode !== 'discard') this.adoptBaseline(session, await this.read(session.resource))
        this.publish(session, { conflict: false, saveError: undefined, readError: undefined })
        if (mode === 'keep') await this.save(session, draft)
        else
          this.publish(session, {
            draft: session.disk.content,
            revision: revision + 1,
            documentEpoch: session.snapshot.documentEpoch + 1
          })
      } catch (error) {
        this.publish(session, { saveError: asError(error) })
        throw error
      } finally {
        session.transition = false
        this.publish(session, { sealed: false })
      }
    })
  }

  private async invalidate(session: Session, preparing = false): Promise<void> {
    this.publish(session, { freshness: 'unknown' })
    if (session.pending || (session.snapshot.sealed && !preparing)) {
      session.needsRevalidation = true
      return
    }
    const generation = ++session.readGeneration
    const revision = session.snapshot.revision
    session.needsRevalidation = false
    try {
      const disk = await this.read(session.resource)
      if (
        session.readGeneration !== generation ||
        session.snapshot.revision !== revision ||
        session.pending ||
        (session.snapshot.sealed && !preparing)
      )
        return
      this.publish(session, { readError: undefined })
      if (session.snapshot.isDirty) {
        if (disk.baseline.contentHash !== session.disk.baseline.contentHash) this.publish(session, { conflict: true })
        else this.adoptBaseline(session, disk)
        return
      }
      const changed = disk.content !== session.disk.content
      this.adoptBaseline(session, disk)
      if (changed)
        this.publish(session, {
          draft: disk.content,
          revision: revision + 1,
          documentEpoch: session.snapshot.documentEpoch + 1
        })
    } catch (error) {
      if (generation === session.readGeneration) {
        if (
          preparing ||
          (error instanceof IpcError &&
            (error.code === fileErrorCodes.EDIT_MISSING || error.code === fileErrorCodes.EDIT_TARGET_CHANGED))
        )
          this.publish(session, { readError: asError(error) })
        logger.warn('File edit observation read failed', {
          sessionId: session.snapshot.sessionId,
          error: asError(error)
        })
      }
    }
  }

  private evict(session: Session): void {
    if (
      session.attachments.size ||
      session.pending ||
      session.transition ||
      session.snapshot.isDirty ||
      session.snapshot.saveError
    )
      return
    if (this.sessions.get(session.key) !== session) return
    this.sessions.delete(session.key)
    this.publishInventory()
    this.cancelTimer(session)
    session.readGeneration++
    void ipcApi
      .request('file.edit.close', { editId: session.resource.editId })
      .catch((error) => logger.error('Edit lease cleanup failed', asError(error)))
  }
}
