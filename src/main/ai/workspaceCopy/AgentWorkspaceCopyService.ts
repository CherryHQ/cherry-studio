import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import path from 'node:path'

import { Semaphore } from 'async-mutex'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import type { AgentWorkspaceCopyRow } from '@data/db/schemas/agentWorkspaceCopy'
import {
  agentWorkspaceCopyRecordService as records,
  type PreparedWorkspaceCopy
} from '@data/services/AgentWorkspaceCopyRecordService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import type { CreateWorkspaceCopyInput, WorkspaceCopyEntity } from '@shared/data/api/schemas/agentWorkspaceCopies'

import { copyWorkspaceTree } from './copyWorkspaceTree'
import { WorkspaceCopyError, fileErrorCode } from './WorkspaceCopyError'
import {
  assertCopyOwnership,
  cleanupCopyOwnership,
  createCopyOwnership,
  directoryIdentity,
  publishCopyTree
} from './workspaceCopyOwnership'
import {
  buildWorkspaceCopyPaths,
  canonicalWorkspacePath,
  containsWorkspacePath,
  outsideGitParent,
  validateWorkspaceStorage
} from './workspaceCopyPaths'

const logger = loggerService.withContext('AgentWorkspaceCopyService')

export interface WorkspaceCopyOperation {
  readonly signal: AbortSignal
  readonly consumer: 'standalone' | 'session-fork'
  readonly forkOperationId?: string
  readonly intendedSessionId?: string
  readonly sourceSessionId?: string
  readonly messageId?: string
  requestCancel(): void
}

type Task = {
  digest: string
  operation: WorkspaceCopyOperation
  admitted: Promise<AgentWorkspaceCopyRow>
  finished: Promise<unknown>
  copyId?: string
}

@Injectable('AgentWorkspaceCopyService')
@ServicePhase(Phase.WhenReady)
export class AgentWorkspaceCopyService extends BaseService {
  private readonly paths = new KeyedMutex()
  private readonly copies = new Semaphore(2)
  private readonly tasks = new Map<string, Task>()
  private readonly cleanupTasks = new Map<string, Promise<void>>()
  private readonly commandTasks = new Set<Promise<unknown>>()
  private readonly leases = new Map<string, number>()
  private readonly admissionHolds = new Set<symbol>()
  private stopping = false
  private recovery: Promise<void> | undefined

  protected override onReady(): void {
    void this.recoverPending().catch((error: unknown) => logger.warn('Workspace copy recovery failed', { error }))
  }

  protected override async onStop(): Promise<void> {
    this.stopping = true
    for (const task of this.tasks.values()) task.operation.requestCancel()
    await this.drain()
  }

  pauseAdmission(): () => void {
    const hold = Symbol('workspace-copy-quiesce')
    this.admissionHolds.add(hold)
    return () => {
      this.admissionHolds.delete(hold)
    }
  }

  async drain(): Promise<void> {
    while (this.tasks.size || this.cleanupTasks.size || this.commandTasks.size || this.recovery) {
      await Promise.allSettled(
        [...this.tasks.values()]
          .map((task) => task.finished)
          .concat([...this.cleanupTasks.values()], [...this.commandTasks], this.recovery ? [this.recovery] : [])
      )
    }
  }

  async drainInFlight({ timeoutMs }: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.drain(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        })
      ])
      return {
        stragglerIds:
          this.tasks.size || this.cleanupTasks.size || this.commandTasks.size || this.recovery ? ['workspace-copy'] : []
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private track<T>(work: Promise<T>): Promise<T> {
    const pending = work.finally(() => this.commandTasks.delete(pending))
    this.commandTasks.add(pending)
    return pending
  }

  private assertAdmission(): void {
    if (this.stopping || this.admissionHolds.size) throw new WorkspaceCopyError('writes_paused', 'admission')
  }

  private digest(
    input: CreateWorkspaceCopyInput,
    operation: Pick<WorkspaceCopyOperation, 'consumer' | 'sourceSessionId' | 'messageId'>
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          input.sourceWorkspaceId,
          input.name?.trim() ?? null,
          operation.consumer,
          operation.sourceSessionId ?? null,
          operation.messageId ?? null
        ])
      )
      .digest('hex')
  }

  findRequest(
    input: CreateWorkspaceCopyInput,
    operation: Pick<WorkspaceCopyOperation, 'consumer' | 'sourceSessionId' | 'messageId'>
  ): AgentWorkspaceCopyRow | undefined {
    const row = records.findRequest(input.requestId)
    if (row && row.requestDigest !== this.digest(input, operation))
      throw new WorkspaceCopyError('request_conflict', 'admission')
    return row
  }

  async startCreate(input: CreateWorkspaceCopyInput): Promise<WorkspaceCopyEntity> {
    const controller = new AbortController()
    const operation: WorkspaceCopyOperation = {
      consumer: 'standalone',
      signal: controller.signal,
      requestCancel: () => controller.abort(new WorkspaceCopyError('cancelled', 'copy'))
    }
    const existing = this.findRequest(input, operation)
    if (existing) return records.toEntity(existing)
    const task = this.launch(input, operation, async (prepared) => {
      await this.assertPreparedCopy(prepared)
      operation.signal.throwIfAborted()
      application.get('DbService').withWriteTx((tx) => records.publishTx(tx, prepared))
    })
    return records.toEntity(await task.admitted)
  }

  async withPreparedCopy<T>(
    input: CreateWorkspaceCopyInput,
    operation: WorkspaceCopyOperation,
    use: (prepared: PreparedWorkspaceCopy) => Promise<T>
  ): Promise<T> {
    return this.launch(input, operation, use).finished as Promise<T>
  }

  async assertPreparedCopy(prepared: PreparedWorkspaceCopy): Promise<void> {
    const row = records.get(prepared.copyId)
    if (row.state !== 'prepared' || row.revision !== prepared.revision)
      throw new WorkspaceCopyError('state_conflict', 'publish')
    await assertCopyOwnership(row, 'project')
  }

  private launch(
    input: CreateWorkspaceCopyInput,
    operation: WorkspaceCopyOperation,
    use: (prepared: PreparedWorkspaceCopy) => Promise<unknown>
  ): Task {
    this.assertAdmission()
    const digest = this.digest(input, operation)
    const current = this.tasks.get(input.requestId)
    if (current) {
      if (current.digest !== digest) throw new WorkspaceCopyError('request_conflict', 'admission')
      return current
    }
    const admitted = Promise.withResolvers<AgentWorkspaceCopyRow>()
    const task: Task = { digest, operation, admitted: admitted.promise, finished: Promise.resolve() }
    task.finished = Promise.resolve().then(async () => {
      let release = () => {}
      let row: AgentWorkspaceCopyRow | undefined
      let resourcesCreated = false
      try {
        const reserved = await this.paths.runExclusive('registration', () => this.reserve(input, operation, digest))
        row = reserved.row
        release = reserved.release
        task.copyId = row.id
        admitted.resolve(row)
        this.notify()
        if (row.state !== 'creating') throw new WorkspaceCopyError(row.errorCode ?? 'state_conflict', 'admission')
        await this.copies.runExclusive(async () => {
          operation.signal.throwIfAborted()
          resourcesCreated = true
          row = await createCopyOwnership(row!, (ownership) =>
            application.get('DbService').withWriteTx((tx) => records.recordOwnershipTx(tx, row!.id, ownership))
          )
          const paths = await assertCopyOwnership(row, 'staging')
          let lastProgress = 0
          const statistics = await copyWorkspaceTree({
            source: row.sourcePath,
            target: paths.staging,
            index: paths.index,
            indexIdentity: row.ownership!.index,
            signal: operation.signal,
            progress: (statistics) => {
              if (Date.now() - lastProgress < 200) return
              lastProgress = Date.now()
              try {
                application
                  .get('IpcApiService')
                  .broadcast('ai.agent.workspace.copy.progress', { copyId: row!.id, statistics })
              } catch (error) {
                logger.warn('Workspace copy progress delivery failed', { error })
              }
            }
          })
          operation.signal.throwIfAborted()
          if ((await directoryIdentity(row.sourcePath)) !== row.sourceIdentity)
            throw new WorkspaceCopyError('source_changed', 'validate')
          await publishCopyTree(row)
          row = application.get('DbService').withWriteTx((tx) => records.markPreparedTx(tx, row!.id, statistics))
        })
        operation.signal.throwIfAborted()
        const result = await use({
          copyId: row.id,
          reservedWorkspaceId: row.reservedWorkspaceId,
          cwd: row.location.project,
          revision: row.revision
        })
        if (records.get(row.id).state !== 'ready') throw new WorkspaceCopyError('not_published', 'publish')
        return result
      } catch (error) {
        admitted.reject(error)
        if (row) {
          row = application
            .get('DbService')
            .withWriteTx((tx) =>
              records.recordFailureTx(
                tx,
                row!.id,
                operation.signal.aborted
                  ? 'cancelled'
                  : error instanceof WorkspaceCopyError
                    ? error.code
                    : (fileErrorCode(error) ?? 'copy_failed'),
                resourcesCreated
              )
            )
          if (row.state === 'ready') return row.intendedSessionId ?? undefined
          if (row.cleanup === 'pending') await this.cleanup(row.id)
        }
        throw error
      } finally {
        release()
        this.tasks.delete(input.requestId)
        this.notify()
      }
    })
    this.tasks.set(input.requestId, task)
    void task.admitted.catch(() => undefined)
    void task.finished.catch((error: unknown) =>
      logger.warn('Workspace copy did not complete', { requestId: input.requestId, error })
    )
    return task
  }

  private borrow(copyId: string): () => void {
    if (records.get(copyId).state !== 'ready') throw new WorkspaceCopyError('workspace_unavailable', 'admission')
    this.leases.set(copyId, (this.leases.get(copyId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.leases.get(copyId)! - 1
      if (count) this.leases.set(copyId, count)
      else this.leases.delete(copyId)
    }
  }

  private async reserve(
    input: CreateWorkspaceCopyInput,
    operation: WorkspaceCopyOperation,
    digest: string
  ): Promise<{ row: AgentWorkspaceCopyRow; release: () => void }> {
    this.assertAdmission()
    operation.signal.throwIfAborted()
    const existing = this.findRequest(input, operation)
    if (existing) return { row: existing, release: () => {} }
    const source = agentWorkspaceService.getById(input.sourceWorkspaceId)
    const sourceCopy = source.storage.type === 'managed-copy' ? records.get(source.storage.copyId) : undefined
    const release = sourceCopy ? this.borrow(sourceCopy.id) : () => {}
    try {
      if (sourceCopy) await assertCopyOwnership(sourceCopy, 'project')
      const sourcePath = await realpath(source.path)
      if (sourcePath === path.parse(sourcePath).root) throw new WorkspaceCopyError('invalid_source', 'admission')
      const sourceIdentity = await directoryIdentity(sourcePath)
      let storageRoot: string
      let storageFallback: string | null = null
      const configuredParent = application.get('PreferenceService').get('agent.workspace_copy.storage_parent')
      if (configuredParent) {
        const parent = await realpath(configuredParent)
        await directoryIdentity(parent)
        storageRoot = await validateWorkspaceStorage(sourcePath, path.join(parent, '.cherry-workspaces'))
        await access(parent, constants.W_OK)
      } else
        try {
          const parent = await outsideGitParent(sourcePath)
          storageRoot = await validateWorkspaceStorage(
            sourcePath,
            sourceCopy?.location.storageRoot ?? path.join(parent, '.cherry-workspaces')
          )
          await access(sourceCopy ? path.dirname(sourceCopy.location.storageRoot) : parent, constants.W_OK)
        } catch (error) {
          storageRoot = await validateWorkspaceStorage(
            sourcePath,
            application.getPath('feature.agents.workspace_copies')
          )
          storageFallback = fileErrorCode(error) ?? 'default_storage_unavailable'
        }
      const copyId = randomUUID()
      const paths = buildWorkspaceCopyPaths({ storageRoot, sourceWorkspaceId: input.sourceWorkspaceId, copyId })
      for (const workspace of agentWorkspaceService.list({ includeSystem: true })) {
        const candidate = await canonicalWorkspacePath(workspace.path)
        if (containsWorkspacePath(candidate, paths.root) || containsWorkspacePath(paths.root, candidate))
          throw new WorkspaceCopyError('workspace_in_use', 'admission')
      }
      operation.signal.throwIfAborted()
      const row = application.get('DbService').withWriteTx((tx) =>
        records.reserveTx(tx, {
          id: copyId,
          requestId: input.requestId,
          requestDigest: digest,
          sourceWorkspaceId: source.id,
          sourcePath,
          sourceIdentity,
          sourceCopyId: sourceCopy?.id,
          consumer: operation.consumer,
          forkOperationId: operation.forkOperationId,
          intendedSessionId: operation.intendedSessionId,
          reservedWorkspaceId: randomUUID(),
          name: input.name?.trim() || t('agent.workspace_copy.name', { name: source.name }),
          location: { version: 1, storageRoot, sourceWorkspaceId: source.id, root: paths.root, project: paths.project },
          ownershipToken: randomUUID(),
          storageFallback
        })
      )
      return { row, release }
    } catch (error) {
      release()
      throw error
    }
  }

  async cancel(copyId: string): Promise<WorkspaceCopyEntity> {
    const task = [...this.tasks.values()].find((candidate) => candidate.copyId === copyId)
    if (task && ['creating', 'prepared'].includes(records.get(copyId).state)) {
      task.operation.requestCancel()
      await task.finished.catch(() => undefined)
    }
    return records.toEntity(records.get(copyId))
  }

  async assertWorkspaceAvailable(workspaceId: string): Promise<void> {
    const workspace = agentWorkspaceService.getById(workspaceId, { includeSystem: true })
    application.get('DbService').withWriteTx((tx) => agentWorkspaceService.assertUsableTx(tx, workspaceId))
    if (workspace.storage.type === 'managed-copy') {
      const release = this.borrow(workspace.storage.copyId)
      try {
        await assertCopyOwnership(records.get(workspace.storage.copyId), 'project')
      } finally {
        release()
      }
    }
  }

  async registerWorkspacePath(input: { path: string; name?: string }) {
    this.assertAdmission()
    return this.track(
      this.paths.runExclusive('registration', async () => {
        const canonical = await realpath(input.path)
        await directoryIdentity(canonical)
        const overlapping = records
          .list()
          .filter(
            (row) =>
              row.state !== 'removed' &&
              (containsWorkspacePath(row.location.root, canonical) ||
                containsWorkspacePath(canonical, row.location.root))
          )
        if (!overlapping.length) return agentWorkspaceService.findOrCreateByPath(canonical, { name: input.name })
        const row = overlapping[0]
        if (overlapping.length !== 1 || canonical !== row.location.project)
          throw new WorkspaceCopyError('managed_workspace_path', 'register')
        const release = this.borrow(row.id)
        try {
          await assertCopyOwnership(row, 'project')
          if ((await realpath(input.path)) !== canonical) throw new WorkspaceCopyError('ownership_mismatch', 'register')
          const id = application.get('DbService').withWriteTx((tx) => records.relinkTx(tx, row.id))
          this.notify()
          return agentWorkspaceService.getById(id)
        } finally {
          release()
        }
      })
    )
  }

  remove(copyId: string, expectedRevision: number): Promise<WorkspaceCopyEntity> {
    return this.track(this.removeInternal(copyId, expectedRevision))
  }

  retryCleanup(copyId: string, expectedRevision: number): Promise<WorkspaceCopyEntity> {
    this.assertAdmission()
    return this.track(
      (async () => {
        const row = records.get(copyId)
        if (row.revision !== expectedRevision || !['failed', 'cancelled', 'deleting'].includes(row.state))
          throw new WorkspaceCopyError('state_conflict', 'cleanup')
        if (row.cleanup !== 'none') await this.cleanup(copyId)
        return records.toEntity(records.get(copyId))
      })()
    )
  }

  private async removeInternal(copyId: string, expectedRevision: number): Promise<WorkspaceCopyEntity> {
    this.assertAdmission()
    await this.paths.runExclusive('registration', async () => {
      const row = records.get(copyId)
      if (row.state === 'removed' || row.state === 'deleting') return
      await assertCopyOwnership(row, 'project')
      await this.assertNoAliases(row)
      application.get('DbService').withWriteTx((tx) => records.beginDeleteTx(tx, copyId, expectedRevision))
    })
    if (records.get(copyId).state === 'deleting') await this.cleanup(copyId)
    return records.toEntity(records.get(copyId))
  }

  private async assertNoAliases(row: AgentWorkspaceCopyRow): Promise<void> {
    for (const workspace of agentWorkspaceService.list({ includeSystem: true })) {
      if (workspace.id === row.targetWorkspaceId) continue
      const candidate = await canonicalWorkspacePath(workspace.path)
      if (containsWorkspacePath(candidate, row.location.root) || containsWorkspacePath(row.location.root, candidate))
        throw new WorkspaceCopyError('workspace_in_use', 'delete')
    }
    if (this.leases.has(row.id)) throw new WorkspaceCopyError('workspace_in_use', 'delete')
  }

  private cleanup(copyId: string): Promise<void> {
    const current = this.cleanupTasks.get(copyId)
    if (current) return current
    const pending = Promise.resolve()
      .then(async () => {
        const row = records.get(copyId)
        try {
          if (row.state === 'deleting') {
            await this.assertNoAliases(row)
            application.get('DbService').withWriteTx((tx) => records.assertUnreferencedTx(tx, row.id))
          }
          await cleanupCopyOwnership(row)
          application
            .get('DbService')
            .withWriteTx((tx) =>
              row.state === 'deleting'
                ? records.finishDeleteTx(tx, copyId)
                : records.recordCleanupTx(tx, copyId, 'none')
            )
        } catch (error) {
          const code = error instanceof WorkspaceCopyError ? error.code : (fileErrorCode(error) ?? 'cleanup_failed')
          const transient = ['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE'].includes(code)
          application
            .get('DbService')
            .withWriteTx((tx) => records.recordCleanupTx(tx, copyId, transient ? 'pending' : 'blocked', code))
          logger.warn('Workspace copy cleanup remains pending', { copyId, error })
        }
      })
      .finally(() => {
        this.cleanupTasks.delete(copyId)
        this.notify()
      })
    this.cleanupTasks.set(copyId, pending)
    return pending
  }

  recoverPending(): Promise<void> {
    if (this.recovery) return this.recovery
    this.recovery = Promise.resolve()
      .then(async () => {
        for (let row of records.listPending()) {
          if (this.tasks.has(row.requestId)) continue
          if (row.state === 'creating' || row.state === 'prepared')
            row = application
              .get('DbService')
              .withWriteTx((tx) => records.recordFailureTx(tx, row.id, 'interrupted', true))
          await this.cleanup(row.id)
        }
      })
      .finally(() => {
        this.recovery = undefined
      })
    return this.recovery
  }

  private notify(): void {
    try {
      notifyDataApiDataChange([
        { endpoint: '/agent-workspace-copies', kind: 'membership' },
        { endpoint: '/agent-workspaces', kind: 'membership' }
      ])
    } catch (error) {
      logger.warn('Workspace copy notification failed', { error })
    }
  }
}
