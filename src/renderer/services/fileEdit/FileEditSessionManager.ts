import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { decodeFileText, encodeFileText, type DecodedFileText } from '@renderer/utils/fileTextSnapshot'
import { isPathInside, isSamePath, toPathKey } from '@renderer/utils/path'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { FileEditBaseline, FileEditResource, FileWriteOutcome } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema, type AbsoluteFilePath } from '@shared/types/file'

import { FileEditObservation } from './FileEditObservation'

const logger = loggerService.withContext('FileEditSessionManager')

export interface SessionSnapshot {
  readonly sessionId: string
  readonly resourceKey: string
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
  readonly outcomeUnknown: boolean
  readonly freshness: 'known' | 'unknown'
  readonly sealed: boolean
}

interface DiskSnapshot extends DecodedFileText {
  baseline: FileEditBaseline
}
interface WriteAttempt {
  resource: FileEditResource
  sequence: number
  text: string
  revision: number
  disk: DiskSnapshot
}
interface Session {
  resource: FileEditResource
  draftResource: FileEditResource
  locators: Map<string, FileEditResource>
  sequences: Map<string, number>
  disk: DiskSnapshot
  snapshot: SessionSnapshot
  listeners: Set<() => void>
  attachments: Set<symbol>
  writer?: symbol
  queue: Promise<void>
  pending: number
  attempt?: WriteAttempt
  timer?: ReturnType<typeof setTimeout>
  readGeneration: number
  transition: boolean
  stopObservation: () => void
  observationHealthy: boolean
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
  commit(move?: { from: AbsoluteFilePath; to: AbsoluteFilePath }): Promise<void>
  cancel(): void
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

class AcquisitionInterruptedError extends Error {}

export class FileEditSessionManager {
  private readonly sessions = new Map<string, Session>()
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
      .filter(
        (session) =>
          !session.attachments.size && (session.snapshot.isDirty || !!session.snapshot.saveError || !!session.attempt)
      )
      .map((session) => session.snapshot)
    for (const listener of this.inventoryListeners) listener()
  }
  async recover(resourceKey: string, action: 'retry' | 'discard'): Promise<void> {
    const session = this.sessions.get(resourceKey)
    if (!session || session.attachments.size) return
    if (action === 'discard') await this.replace(session, 'discard')
    else await this.flush(session)
  }

  async prepareMutation(roots: readonly AbsoluteFilePath[]): Promise<PreparedFileMutation> {
    if (this.composing || this.mutationSettled) throw new Error('File editing is not ready for a transition')
    const affected = [...this.sessions.values()].filter((session) =>
      roots.some((root) => isSamePath(session.resource.path, root) || isPathInside(session.resource.path, root))
    )
    if (affected.some((session) => session.transition || session.snapshot.sealed))
      throw new Error('A file transition is already running')
    const settlement = Promise.withResolvers<void>()
    this.mutationSettled = settlement.promise
    this.acquisitionEpoch++
    for (const session of affected) {
      session.transition = true
      this.cancelTimer(session)
      this.publish(session, { sealed: true })
    }
    let finished = false
    const cancel = () => {
      if (finished) return
      finished = true
      for (const session of affected) {
        session.transition = false
        this.publish(session, { sealed: false })
        this.evict(session)
        if (this.sessions.get(session.resource.resourceKey) === session) void this.invalidate(session)
      }
      this.mutationSettled = undefined
      settlement.resolve()
    }
    const results = await Promise.allSettled(affected.map((session) => this.flush(session)))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      cancel()
      throw failure.reason
    }
    return {
      cancel,
      commit: async (move) => {
        if (finished) return
        finished = true
        const results = await Promise.allSettled(
          affected.map(async (session) => {
            try {
              if (move) {
                if (!isSamePath(session.resource.path, move.from) && !isPathInside(session.resource.path, move.from))
                  return
                const source = toPathKey(move.from)
                const original = toPathKey(session.resource.path)
                const target = toPathKey(move.to)
                if (source === null || original === null || target === null)
                  throw new Error('File move address is unsupported')
                const path = AbsoluteFilePathSchema.parse(target + original.slice(source.length))
                const resource = await ipcApi.request('file.edit.open', { handle: { kind: 'path', path } })
                if (this.sessions.has(resource.resourceKey) && this.sessions.get(resource.resourceKey) !== session) {
                  await ipcApi.request('file.edit.close', { editId: resource.editId })
                  throw new Error('Destination already has an editing session')
                }
                let disk: DiskSnapshot
                try {
                  disk = await this.read(resource)
                  if (disk.baseline.contentHash !== session.disk.baseline.contentHash)
                    throw new Error('Moved file content changed before rebinding')
                } catch (error) {
                  await ipcApi.request('file.edit.close', { editId: resource.editId })
                  throw error
                }
                const oldResource = session.resource
                const oldLocators = [...session.locators.values()]
                this.sessions.delete(oldResource.resourceKey)
                session.stopObservation()
                session.resource = resource
                session.draftResource = resource
                session.locators = new Map([[JSON.stringify({ kind: 'path', path }), resource]])
                session.sequences.clear()
                session.writer = undefined
                this.sessions.set(resource.resourceKey, session)
                session.stopObservation = this.observation.subscribe(resource.observationRoot, (available) => {
                  session.observationHealthy = available
                  void this.invalidate(session)
                }).dispose
                this.adoptBaseline(session, disk)
                this.publish(session, {
                  sessionId: crypto.randomUUID(),
                  resourceKey: resource.resourceKey,
                  documentEpoch: session.snapshot.documentEpoch + 1
                })
                await Promise.all(
                  oldLocators.map((locator) => ipcApi.request('file.edit.close', { editId: locator.editId }))
                )
              } else {
                session.writer = undefined
                this.sessions.delete(session.resource.resourceKey)
                session.stopObservation()
                await Promise.all(
                  [...session.locators.values()].map((locator) =>
                    ipcApi.request('file.edit.close', { editId: locator.editId })
                  )
                )
              }
            } catch (error) {
              this.publish(session, { saveError: asError(error) })
              throw error
            } finally {
              session.transition = false
              this.publish(session, { sealed: false })
              this.evict(session)
            }
          })
        )
        const failed = results.find((result) => result.status === 'rejected')
        this.mutationSettled = undefined
        settlement.resolve()
        if (failed?.status === 'rejected') throw failed.reason
      }
    }
  }
  private readonly observation = new FileEditObservation()

  async acquire(handle: FileHandle): Promise<SessionLease> {
    for (;;) {
      while (this.mutationSettled) await this.mutationSettled
      try {
        return await this.open(handle, this.acquisitionEpoch)
      } catch (error) {
        if (!(error instanceof AcquisitionInterruptedError)) throw error
      }
    }
  }

  listRetained(): readonly SessionSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot)
  }

  private async open(handle: FileHandle, acquisitionEpoch: number): Promise<SessionLease> {
    const resource = await ipcApi.request('file.edit.open', { handle })
    try {
      if (this.mutationSettled || acquisitionEpoch !== this.acquisitionEpoch)
        throw new AcquisitionInterruptedError('File sessions are transitioning')
      let session = this.sessions.get(resource.resourceKey)
      if (!session) {
        let observed: Session | undefined
        const watch = this.observation.subscribe(resource.observationRoot, (available) => {
          if (observed) {
            observed.observationHealthy = available
            void this.invalidate(observed)
          }
        })
        let disk: DiskSnapshot
        let observationSequence: number
        try {
          await watch.ready
          observationSequence = watch.getSequence()
          disk = await this.read(resource)
        } catch (error) {
          watch.dispose()
          throw error
        }
        if (this.mutationSettled || acquisitionEpoch !== this.acquisitionEpoch) {
          watch.dispose()
          throw new AcquisitionInterruptedError('File sessions are transitioning')
        }
        session = this.sessions.get(resource.resourceKey)
        if (!session) {
          session = {
            resource,
            draftResource: resource,
            locators: new Map([[JSON.stringify(handle), resource]]),
            sequences: new Map(),
            disk,
            listeners: new Set(),
            attachments: new Set(),
            queue: Promise.resolve(),
            pending: 0,
            readGeneration: 0,
            transition: false,
            stopObservation: watch.dispose,
            observationHealthy: watch.isActive(),
            needsRevalidation: false,
            snapshot: {
              sessionId: crypto.randomUUID(),
              resourceKey: resource.resourceKey,
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
              outcomeUnknown: false,
              freshness: watch.isActive() ? 'known' : 'unknown',
              sealed: false
            }
          }
          this.sessions.set(resource.resourceKey, session)
          observed = session
          if (observationSequence !== watch.getSequence()) void this.invalidate(session)
        } else watch.dispose()
      }
      const locatorKey = JSON.stringify(handle)
      const locator = session.locators.get(locatorKey) ?? resource
      session.locators.set(locatorKey, locator)
      const attachment = this.attach(session, locator)
      if (locator.editId !== resource.editId) {
        void ipcApi
          .request('file.edit.close', { editId: resource.editId })
          .catch((error) => logger.error('Redundant edit lease cleanup failed', asError(error)))
      }
      return attachment
    } catch (error) {
      await ipcApi
        .request('file.edit.close', { editId: resource.editId })
        .catch((closeError) => logger.error('Edit lease cleanup failed', asError(closeError)))
      throw error
    }
  }

  private attach(session: Session, locator: FileEditResource): SessionLease {
    const attachment = Symbol('file attachment')
    session.attachments.add(attachment)
    this.publishInventory()
    const writable = session.writer === undefined
    if (writable) session.writer = attachment
    let released = false
    const current = () => !released && session.writer === attachment && !session.snapshot.sealed
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
      writable,
      acceptEdit: (
        text,
        documentEpoch = session.snapshot.documentEpoch,
        bindingEpoch = session.snapshot.bindingEpoch
      ) => {
        if (
          !current() ||
          documentEpoch !== session.snapshot.documentEpoch ||
          bindingEpoch !== session.snapshot.bindingEpoch
        )
          return false
        const draft = text.replace(/\r\n?/g, '\n')
        if (draft === session.snapshot.draft) return true
        session.draftResource = locator
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
        if (session.writer === attachment) {
          session.writer = undefined
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
        : session.snapshot.bindingEpoch
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
      freshness: session.observationHealthy ? 'known' : 'unknown'
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
          this.sessions.get(session.resource.resourceKey) === session
        )
          void this.invalidate(session)
      })
    return task
  }

  private flush(session: Session): Promise<void> {
    this.cancelTimer(session)
    const { draft, revision } = session.snapshot
    const resource = session.draftResource
    return this.enqueue(session, async () => {
      try {
        await this.settle(session)
        if (session.snapshot.conflict) throw new IpcError(fileErrorCodes.STALE_VERSION, 'File has external changes')
        await this.save(session, draft, revision, resource)
        this.publish(session, { saveError: undefined })
        if (session.snapshot.isDirty && session.pending === 1) this.schedule(session)
      } catch (error) {
        this.publish(session, { saveError: asError(error) })
        throw error
      }
    })
  }

  private async save(
    session: Session,
    text: string,
    revision: number,
    resource = session.draftResource
  ): Promise<void> {
    for (let retries = 0; retries < 4; retries++) {
      if (text === session.disk.content) return
      const sequence = (session.sequences.get(resource.editId) ?? 0) + 1
      session.sequences.set(resource.editId, sequence)
      const attempt = { sequence, resource, text, revision, disk: session.disk }
      const data = encodeFileText(text, attempt.disk.lineEnding, attempt.disk.hasBom)
      session.attempt = attempt
      let outcome: FileWriteOutcome
      try {
        outcome = await ipcApi.request('file.edit.write', {
          editId: attempt.resource.editId,
          sequence: attempt.sequence,
          expected: attempt.disk.baseline,
          data
        })
      } catch {
        this.publish(session, { outcomeUnknown: true })
        outcome = await ipcApi.request('file.edit.settle_write', {
          editId: attempt.resource.editId,
          sequence: attempt.sequence
        })
      }
      this.applyOutcome(session, attempt, outcome)
      if (outcome.kind === 'committed') return
      if (outcome.kind === 'not-started') throw new Error('File save did not start')
      if (outcome.code !== fileErrorCodes.STALE_VERSION) throw new IpcError(outcome.code, 'File save failed')
      const disk = await this.read(attempt.resource)
      if (disk.content === text || disk.baseline.contentHash === attempt.disk.baseline.contentHash) {
        this.adoptBaseline(session, disk)
        continue
      }
      this.publish(session, { conflict: true })
      throw new IpcError(fileErrorCodes.STALE_VERSION, 'File has external changes')
    }
    throw new IpcError(fileErrorCodes.STALE_VERSION, 'File changed repeatedly during save')
  }

  private applyOutcome(session: Session, attempt: WriteAttempt, outcome: FileWriteOutcome): void {
    if (outcome.sequence !== attempt.sequence) throw new Error('Mismatched file save receipt')
    session.attempt = undefined
    this.publish(session, { outcomeUnknown: false })
    if (outcome.kind === 'committed') {
      this.adoptBaseline(session, { ...attempt.disk, content: attempt.text, baseline: outcome.baseline })
      this.publish(session, { metadataRecoveryPending: outcome.metadataRecoveryPending, saveError: undefined })
    }
  }

  private async settle(session: Session): Promise<void> {
    const attempt = session.attempt
    if (!attempt) return
    const outcome = await ipcApi.request('file.edit.settle_write', {
      editId: attempt.resource.editId,
      sequence: attempt.sequence
    })
    this.applyOutcome(session, attempt, outcome)
    if (outcome.kind === 'not-committed' && outcome.code === fileErrorCodes.STALE_VERSION) {
      this.publish(session, { conflict: true })
    }
  }

  private replace(session: Session, mode: 'discard' | 'reload' | 'keep'): Promise<void> {
    if (session.transition) return Promise.reject(new Error('File transition is already running'))
    session.transition = true
    this.cancelTimer(session)
    this.publish(session, { sealed: true })
    const { draft, revision } = session.snapshot
    return this.enqueue(session, async () => {
      try {
        await this.settle(session)
        if (mode !== 'discard') this.adoptBaseline(session, await this.read(session.resource))
        this.publish(session, { conflict: false, saveError: undefined })
        if (mode === 'keep') await this.save(session, draft, revision)
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

  private async invalidate(session: Session): Promise<void> {
    const generation = ++session.readGeneration
    const revision = session.snapshot.revision
    this.publish(session, { freshness: 'unknown' })
    if (session.pending || session.snapshot.sealed) {
      session.needsRevalidation = true
      return
    }
    session.needsRevalidation = false
    try {
      const disk = await this.read(session.resource)
      if (
        session.readGeneration !== generation ||
        session.snapshot.revision !== revision ||
        session.pending ||
        session.snapshot.sealed
      )
        return
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
      if (generation === session.readGeneration)
        logger.warn('File edit observation read failed', {
          resourceKey: session.resource.resourceKey,
          error: asError(error)
        })
    }
  }

  private evict(session: Session): void {
    if (
      session.attachments.size ||
      session.pending ||
      session.transition ||
      session.snapshot.isDirty ||
      session.snapshot.saveError ||
      session.attempt
    )
      return
    if (this.sessions.get(session.resource.resourceKey) !== session) return
    this.sessions.delete(session.resource.resourceKey)
    this.publishInventory()
    session.stopObservation()
    this.cancelTimer(session)
    session.readGeneration++
    void Promise.all(
      [...session.locators.values()].map((locator) => ipcApi.request('file.edit.close', { editId: locator.editId }))
    ).catch((error) => logger.error('Edit lease cleanup failed', asError(error)))
  }
}
