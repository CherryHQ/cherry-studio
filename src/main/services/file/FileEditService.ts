import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { atomicWriteIfUnchanged, hashContent, PathStaleVersionError } from '@main/utils/file'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import {
  type FileEditRead,
  type FileEditResource,
  type FileEditWrite,
  type FileEditWriteResult
} from '@shared/ipc/schemas/fileEdit'
import type { WindowId } from '@shared/ipc/types'
import { AbsoluteFilePathSchema, type AbsoluteFilePath } from '@shared/types/file'

import { ContentCommittedMetadataPendingError, StaleVersionError } from './FileManager'
import { runPathMutationExclusive } from './pathMutationLock'
import { readEditSnapshot } from './utils/editSnapshot'
import { assertOutsideManagedStorageMutation } from './utils/managedStorageGuard'

const logger = loggerService.withContext('FileEditService')
const MAX_LEASES_PER_WINDOW = 64
interface EditLease {
  owner: WindowId
  resource: FileEditResource
  path: AbsoluteFilePath
  handle: FileHandle
  pending: Set<Promise<unknown>>
  retention?: Disposable
  closing?: Promise<void>
}

@Injectable('FileEditService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'WindowManager'])
export class FileEditService extends BaseService {
  private readonly leases = new Map<string, EditLease>()
  private readonly closedOwners = new Set<WindowId>()
  private stopped = false

  protected override onInit(): void {
    this.stopped = false
    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyed(({ id }) => {
        this.closedOwners.add(id)
        void this.closeOwner(id).catch((error) => logger.error('Failed to release file edit leases', error))
      })
    )
  }

  protected override async onStop(): Promise<void> {
    this.stopped = true
    await Promise.all([...this.leases.values()].map((lease) => this.close(lease.owner, lease.resource.editId)))
  }

  async open(owner: WindowId, handle: FileHandle): Promise<FileEditResource> {
    let retention: Disposable | undefined
    try {
      if (this.stopped || this.closedOwners.has(owner)) throw this.closed()
      if (handle.kind === 'entry') {
        const files = application.get('FileManager')
        const entry = await files.getById(handle.entryId)
        if (entry.origin === 'internal' && entry.cleanupPolicy === 'delete_when_unreferenced')
          retention = files.retainTemporaryEntry(entry.id)
      }
      const path = await this.resolve(handle)
      if (handle.kind === 'path') await assertOutsideManagedStorageMutation(handle.path, path)
      if (this.stopped || this.closedOwners.has(owner)) throw this.closed()
      if ([...this.leases.values()].filter((lease) => lease.owner === owner).length >= MAX_LEASES_PER_WINDOW) {
        throw new IpcError(fileErrorCodes.EDIT_LIMIT, 'Too many retained file editing sessions')
      }
      const resource = { editId: randomUUID() }
      this.leases.set(resource.editId, {
        owner,
        resource,
        path,
        handle: { ...handle },
        pending: new Set(),
        retention
      })
      return resource
    } catch (error) {
      retention?.dispose()
      throw this.normalize(error)
    }
  }

  async read(owner: WindowId, editId: string): Promise<FileEditRead> {
    const lease = this.require(owner, editId)
    const task =
      lease.handle.kind === 'entry'
        ? application.get('FileManager').readEditSnapshot(lease.handle.entryId, lease.path)
        : runPathMutationExclusive(async () => {
            await this.validateTarget(lease)
            return readEditSnapshot(lease.path)
          })
    lease.pending.add(task)
    try {
      const snapshot = await task
      this.require(owner, editId)
      return snapshot
    } catch (error) {
      throw this.normalize(error)
    } finally {
      lease.pending.delete(task)
    }
  }

  async write(owner: WindowId, input: FileEditWrite): Promise<FileEditWriteResult> {
    const lease = this.require(owner, input.editId)
    const data = new Uint8Array(input.data)
    const { expected } = input
    const contentHash = hashContent(data)
    const task = (async (): Promise<FileEditWriteResult> => {
      try {
        const version =
          lease.handle.kind === 'entry'
            ? await application
                .get('FileManager')
                .writeIfUnchanged(lease.handle.entryId, data, expected.version, expected.contentHash, lease.path)
            : await runPathMutationExclusive(async () => {
                await this.validateTarget(lease)
                return atomicWriteIfUnchanged(lease.path, data, expected.version, expected.contentHash)
              })
        return { baseline: { version, contentHash }, metadataRecoveryPending: false }
      } catch (error) {
        if (error instanceof ContentCommittedMetadataPendingError) {
          return { baseline: { version: error.version, contentHash }, metadataRecoveryPending: true }
        }
        const failure = this.normalize(error)
        logger.warn('File edit write did not commit', { editId: input.editId, code: failure.code })
        throw failure
      }
    })()
    lease.pending.add(task)
    try {
      return await task
    } finally {
      lease.pending.delete(task)
    }
  }

  async close(owner: WindowId, editId: string): Promise<void> {
    const lease = this.leases.get(editId)
    if (!lease) return
    if (lease.owner !== owner) throw this.closed()
    lease.closing ??= (async () => {
      await Promise.allSettled(lease.pending)
      this.leases.delete(editId)
      lease.retention?.dispose()
    })()
    await lease.closing
  }

  private async closeOwner(owner: WindowId): Promise<void> {
    await Promise.all(
      [...this.leases.values()]
        .filter((lease) => lease.owner === owner)
        .map((lease) => this.close(owner, lease.resource.editId))
    )
  }

  private require(owner: WindowId, editId: string): EditLease {
    const lease = this.leases.get(editId)
    if (!lease || lease.owner !== owner || lease.closing || this.stopped) throw this.closed()
    return lease
  }

  private async validateTarget(lease: EditLease): Promise<void> {
    if ((await this.resolve(lease.handle)) !== lease.path)
      throw new IpcError(fileErrorCodes.EDIT_TARGET_CHANGED, 'Editing target changed')
    await assertOutsideManagedStorageMutation(lease.path)
  }

  private async resolve(handle: FileHandle): Promise<AbsoluteFilePath> {
    const path = handle.kind === 'entry' ? application.get('FileManager').getPhysicalPath(handle.entryId) : handle.path
    return AbsoluteFilePathSchema.parse(await realpath(path))
  }

  private closed(): IpcError {
    return new IpcError(fileErrorCodes.EDIT_LEASE_CLOSED, 'File edit lease is unavailable')
  }

  private normalize(error: unknown): IpcError {
    if (error instanceof IpcError) return error
    if (error instanceof PathStaleVersionError || error instanceof StaleVersionError) {
      return new IpcError(fileErrorCodes.STALE_VERSION, 'File changed since the editing baseline')
    }
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    const mapped =
      code === 'ENOENT' || code === 'ENOTDIR' || code === 'NOT_FOUND'
        ? fileErrorCodes.EDIT_MISSING
        : code === 'EACCES' || code === 'EPERM'
          ? fileErrorCodes.EDIT_PERMISSION
          : code === 'ENOSPC' || code === 'EDQUOT'
            ? fileErrorCodes.EDIT_NO_SPACE
            : fileErrorCodes.EDIT_IO
    return new IpcError(mapped, 'File editing I/O failed')
  }
}
