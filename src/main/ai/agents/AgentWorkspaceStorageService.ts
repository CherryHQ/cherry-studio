import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, openSync, realpathSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { newestMtimeMs } from '@main/ai/runtime/orphanSessionReclaim'
import type { OrphanSessionReclaimOptions } from '@main/ai/runtime/types'
import { createPathOverlapCheck, nearestExistingRealPathSync, type PathNameBehavior } from '@main/utils/file'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import * as storage from './agentWorkspaceStorage'

const logger = loggerService.withContext('AgentWorkspaceStorageService')
type Workspace = { id: string; path: string }
type ArchiveRecord = Extract<storage.WorkspaceStorageRecord, { operation: 'archive' }>
type RestoreRecord = Extract<storage.WorkspaceStorageRecord, { operation: 'restore' }>

function probeNameBehavior(directory: string): PathNameBehavior {
  const name = `.cherry-path-${randomUUID()}-Aa-é`
  const probe = path.join(directory, name)
  const handle = openSync(probe, 'wx', 0o600)
  try {
    const stat = lstatSync(probe, { bigint: true })
    const aliases = (variant: string) => {
      try {
        const other = lstatSync(path.join(directory, variant), { bigint: true })
        return stat.dev === other.dev && stat.ino === other.ino
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    }
    return { caseSensitive: !aliases(name.toUpperCase()), unicodeSensitive: !aliases(name.normalize('NFD')) }
  } finally {
    closeSync(handle)
    unlinkSync(probe)
  }
}

class AgentWorkspaceStorageService {
  private readonly blockedRelocations = new Set<string>()

  blockRelocation(workspacePath: string): void {
    this.blockedRelocations.add(path.resolve(workspacePath))
  }

  isRelocationBlocked(workspacePath: string): boolean {
    return this.blockedRelocations.has(path.resolve(workspacePath))
  }

  completeRelocation(oldPath: string, newPath: string): void {
    this.blockedRelocations.delete(path.resolve(oldPath))
    this.blockedRelocations.delete(path.resolve(newPath))
  }

  private readonly reservations = new Set<{ paths: readonly string[]; overlaps: (candidate: string) => boolean }>()

  registerWorkspace(workspacePath: string, options: { name?: string } = {}) {
    if ([...this.reservations].some((reservation) => reservation.overlaps(workspacePath.trim()))) {
      throw new Error('Workspace storage is in use; retry after the operation completes')
    }
    return agentWorkspaceService.findOrCreateByPathResult(workspacePath, options).workspace
  }

  reserveWorkspaceStorage(
    paths: readonly string[],
    ownerPaths: string | readonly string[] = []
  ): (() => void) | undefined {
    const managedRoot = application.getPath('feature.agents.system_workspaces')
    if (!existsSync(managedRoot)) return undefined
    const rootStat = lstatSync(managedRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new Error('Workspace storage root must be a real directory')
    const root = realpathSync.native(managedRoot)
    const owners = (typeof ownerPaths === 'string' ? [ownerPaths] : ownerPaths).map((owner) => path.resolve(owner))
    const claims = agentWorkspaceService
      .listStorageClaims()
      .filter((row) => row.type !== AGENT_WORKSPACE_TYPE.SYSTEM || !owners.includes(path.resolve(row.path)))
    const exactOverlap = createPathOverlapCheck(paths, new Map())
    if (claims.some((row) => exactOverlap(row.path))) return undefined
    const behaviors = new Map<string, PathNameBehavior>()
    for (const target of paths) {
      let current = path.resolve(managedRoot)
      const relative = path.relative(current, path.dirname(target))
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Workspace reservation is outside managed storage: ${target}`)
      }
      for (const segment of relative ? relative.split(path.sep) : []) {
        current = path.join(current, segment)
        try {
          const stat = lstatSync(current)
          if (stat.isSymbolicLink()) throw new Error(`Workspace reservation parent is linked: ${current}`)
          if (!stat.isDirectory()) break
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
          break
        }
      }
      let parent = path.resolve(path.dirname(target))
      for (;;) {
        try {
          const stat = lstatSync(parent)
          if (stat.isSymbolicLink()) throw new Error(`Workspace reservation parent is linked: ${parent}`)
          if (stat.isDirectory()) break
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
        const next = path.dirname(parent)
        if (next === parent) throw new Error(`No workspace reservation parent: ${target}`)
        parent = next
      }
      parent = realpathSync.native(parent)
      if (parent !== root && !parent.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)) {
        throw new Error(`Workspace reservation is outside managed storage: ${target}`)
      }
      if (!behaviors.has(parent)) behaviors.set(parent, probeNameBehavior(parent))
      const behavior = behaviors.get(parent)!
      let missing = nearestExistingRealPathSync(path.dirname(target))
      while (missing !== parent) {
        behaviors.set(missing, behavior)
        missing = path.dirname(missing)
      }
      behaviors.set(path.resolve(path.dirname(target)), behavior)
    }
    const overlaps = createPathOverlapCheck(paths, behaviors)
    for (const row of claims) {
      if (overlaps(row.path)) return undefined
    }
    if (
      [...this.reservations].some((reservation) => paths.some(reservation.overlaps) || reservation.paths.some(overlaps))
    )
      return undefined
    const reservation = { paths, overlaps }
    this.reservations.add(reservation)
    return () => {
      this.reservations.delete(reservation)
    }
  }

  workspaceStoragePaths(workspace: string): string[] {
    return ['', ...storage.WORKSPACE_STORAGE_SUFFIXES].map((suffix) => `${workspace}${suffix}`)
  }

  private async withSystemWorkspaceStorage<T>(
    workspace: string,
    operation: () => Promise<T>,
    orphan = false
  ): Promise<T | undefined> {
    const release = this.reserveWorkspaceStorage(this.workspaceStoragePaths(workspace), orphan ? [] : workspace)
    if (!release) return undefined
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async archiveWorkspace(workspace: Workspace): Promise<void> {
    if (!existsSync(application.getPath('feature.agents.system_workspaces'))) await this.quiesce(workspace.id)
    await this.withSystemWorkspaceStorage(workspace.path, async () => {
      await this.quiesce(workspace.id)
      const root = application.getPath('feature.agents.system_workspaces')
      const state = await this.inspect(root, workspace)
      if (!state) return
      if (state.record?.operation === 'restore') await this.commitRestore(root, workspace.path, state.record)
      else if (state.record?.operation === 'purge') throw new Error('Workspace deletion is pending')
      await this.archive(root, workspace)
    })
  }

  async restoreWorkspaces<T>(workspaces: Workspace[], activate: () => T): Promise<T> {
    if (!workspaces.length) return activate()
    const root = application.getPath('feature.agents.system_workspaces')
    if (!existsSync(root)) {
      for (const workspace of workspaces) await this.quiesce(workspace.id)
      if (!existsSync(root)) return activate()
    }
    const paths = [...new Set(workspaces.map((workspace) => workspace.path))].sort()
    const release = this.reserveWorkspaceStorage(
      paths.flatMap((workspace) => this.workspaceStoragePaths(workspace)),
      paths
    )
    if (!release)
      throw DataApiErrorFactory.conflict('Workspace storage is in use; cannot safely restore this session', 'Workspace')
    try {
      const restored: Array<{ path: string; record: RestoreRecord }> = []
      for (const workspace of workspaces) {
        await this.quiesce(workspace.id)
        const record = await this.restore(root, workspace)
        if (record) restored.push({ path: workspace.path, record })
      }
      const result = activate()
      for (const workspace of restored) {
        try {
          await this.commitRestore(root, workspace.path, workspace.record)
        } catch (error) {
          logger.warn('Workspace restore cleanup retained for retry', { workspace: workspace.path, error })
        }
      }
      return result
    } finally {
      release()
    }
  }

  async reconcileWorkspace(workspace: Workspace, lifecycle: 'active' | 'archived'): Promise<void> {
    await this.withSystemWorkspaceStorage(workspace.path, async () => {
      const root = application.getPath('feature.agents.system_workspaces')
      const state = await this.inspect(root, workspace)
      if (!state || (lifecycle === 'active' && !state.record)) return
      if (lifecycle === 'archived') await this.quiesce(workspace.id)
      if (state.record?.operation === 'restore') {
        const record = await this.restore(root, workspace)
        if (record && lifecycle === 'active') await this.commitRestore(root, workspace.path, record)
      } else if (lifecycle === 'archived') await this.archive(root, workspace)
      else throw new Error('Active session has an unfinished workspace storage operation')
    })
  }

  async purgeWorkspace(workspace: Workspace): Promise<void> {
    await this.withSystemWorkspaceStorage(workspace.path, () => this.purge(workspace), true)
  }

  async reclaimOrphanWorkspace(workspacePath: string, options: OrphanSessionReclaimOptions): Promise<string[]> {
    return (
      (await this.withSystemWorkspaceStorage(
        workspacePath,
        async () => {
          const artifacts: string[] = []
          for (const target of this.workspaceStoragePaths(workspacePath)) {
            const newest = await newestMtimeMs(target)
            if (newest === null) continue
            if (options.now - newest <= options.freshnessGateMs) return []
            artifacts.push(target)
          }
          if (artifacts.length) await this.purge({ id: path.basename(workspacePath), path: workspacePath })
          return artifacts
        },
        true
      )) ?? []
    )
  }

  private async quiesce(sessionId: string): Promise<void> {
    const runtime = application.get('AgentSessionRuntimeService')
    await runtime.cancelSessionForks(sessionId)
    await runtime.closeSessionForArchive(sessionId)
  }

  private async inspect(root: string, workspace: Workspace) {
    const state = await storage.inspectWorkspaceStorage(root, workspace.path)
    if (state?.record && state.record.sessionId !== workspace.id)
      throw new Error('Workspace operation belongs to another session')
    return state
  }

  private async archive(root: string, workspace: Workspace): Promise<void> {
    const state = await this.inspect(root, workspace)
    if (!state) return
    let record = state.record
    if (record && record.operation !== 'archive') throw new Error('Workspace has another pending storage operation')
    if (!record) {
      if (!state.directory && !state.pending) return
      if (state.archive || (state.directory && state.pending))
        throw new Error('Workspace storage has unverified copies')
      record = {
        version: 1,
        operationId: randomUUID(),
        sessionId: workspace.id,
        operation: 'archive',
        phase: 'staging',
        directory: await storage.workspaceDirectoryIdentity(
          root,
          state.pending ? `${workspace.path}.archiving` : workspace.path
        )
      }
      await storage.writeWorkspaceStorageRecord(workspace.path, record)
    }
    await this.finishArchive(root, workspace.path, record)
  }

  private async finishArchive(root: string, workspace: string, initial: ArchiveRecord): Promise<void> {
    let record = initial
    const pending = `${workspace}.archiving`
    const temporary = `${workspace}.tar.gz.tmp`
    const archive = `${workspace}.tar.gz`
    if (record.phase === 'staging') {
      if (await storage.workspaceStat(workspace)) {
        await storage.assertWorkspaceDirectoryIdentity(root, workspace, record.directory)
        await storage.moveWorkspacePath(root, workspace, pending)
      } else await storage.assertWorkspaceDirectoryIdentity(root, pending, record.directory)
      record = { ...record, phase: 'packing' }
      await storage.writeWorkspaceStorageRecord(workspace, record)
    }
    if (record.phase === 'packing') {
      await storage.assertWorkspaceDirectoryIdentity(root, pending, record.directory)
      const archiveHash = await storage.packWorkspaceDirectory(pending, temporary)
      record = { ...record, phase: 'publishing', archiveHash }
      await storage.writeWorkspaceStorageRecord(workspace, record)
    }
    const published = await storage.workspaceStat(archive)
    if (!published || (await storage.workspaceArchiveHash(archive)) !== record.archiveHash) {
      if (published) {
        throw new Error('Workspace archive changed')
      }
      await storage.assertWorkspaceArchiveHash(temporary, record.archiveHash!)
      await storage.publishWorkspaceArchive(root, temporary, archive)
    }
    await storage.assertWorkspaceArchiveHash(archive, record.archiveHash!)
    await storage.removeWorkspaceArtifact(root, pending, record.directory)
    await storage.removeWorkspaceArtifact(root, temporary)
    await storage.clearWorkspaceStorageRecord(workspace)
  }

  private async restore(root: string, workspace: Workspace): Promise<RestoreRecord | undefined> {
    let state = await this.inspect(root, workspace)
    if (!state) return undefined
    let record = state.record
    if (record?.operation === 'purge') throw new Error('Workspace deletion is pending')
    if (record?.operation === 'archive' && record.phase === 'publishing') {
      await this.finishArchive(root, workspace.path, record)
      state = (await this.inspect(root, workspace))!
      record = undefined
    }
    if (record?.operation !== 'restore') {
      if (state.directory && state.pending) throw new Error('Workspace destination is occupied')
      if ((state.directory || state.pending) && state.archive && !record)
        throw new Error('Workspace destination is occupied')
      if (!state.directory && !state.pending && !state.archive) return undefined
      const source = state.pending ? 'pending' : state.directory ? 'directory' : 'archive'
      if (source === 'archive') await storage.validateWorkspaceArchive(`${workspace.path}.tar.gz`)
      if (record?.operation === 'archive') {
        await storage.assertWorkspaceDirectoryIdentity(
          root,
          source === 'pending' ? `${workspace.path}.archiving` : workspace.path,
          record.directory
        )
      }
      record = {
        version: 1,
        operationId: randomUUID(),
        sessionId: workspace.id,
        operation: 'restore',
        phase: 'preparing',
        source,
        ...(state.archive ? { archiveHash: await storage.workspaceArchiveHash(`${workspace.path}.tar.gz`) } : {}),
        ...(source !== 'archive'
          ? {
              directory: await storage.workspaceDirectoryIdentity(
                root,
                source === 'pending' ? `${workspace.path}.archiving` : workspace.path
              )
            }
          : {})
      }
      await storage.writeWorkspaceStorageRecord(workspace.path, record)
    }
    return this.finishRestore(root, workspace.path, record)
  }

  private async finishRestore(root: string, workspace: string, initial: RestoreRecord): Promise<RestoreRecord> {
    let record = initial
    const pending = `${workspace}.archiving`
    const archive = `${workspace}.tar.gz`
    const stage = path.join(`${workspace}.restoring`, record.operationId)
    if (record.archiveHash && (record.phase !== 'committed' || (await storage.workspaceStat(archive))))
      await storage.assertWorkspaceArchiveHash(archive, record.archiveHash)
    if (record.phase === 'preparing') {
      if (record.source === 'archive') {
        if (await storage.workspaceStat(workspace)) throw new Error('Workspace destination is occupied')
        await storage.ensureWorkspaceStage(root, stage)
        await storage.clearWorkspaceStage(root, stage)
        await storage.unpackWorkspaceArchive(archive, stage)
        record = { ...record, phase: 'prepared', directory: await storage.workspaceDirectoryIdentity(root, stage) }
      } else {
        await storage.assertWorkspaceDirectoryIdentity(
          root,
          record.source === 'pending' ? pending : workspace,
          record.directory!
        )
        record = { ...record, phase: record.source === 'directory' ? 'published' : 'prepared' }
      }
      await storage.writeWorkspaceStorageRecord(workspace, record)
    }
    if (record.phase === 'prepared') {
      if (!(await storage.workspaceStat(workspace))) {
        if (record.source === 'pending' && (await storage.workspaceStat(pending))) {
          await storage.assertWorkspaceDirectoryIdentity(root, pending, record.directory!)
          await storage.ensureWorkspaceStage(root, `${workspace}.restoring`)
          await storage.moveWorkspacePath(root, pending, stage)
        }
        await storage.assertWorkspaceDirectoryIdentity(root, stage, record.directory!)
        await storage.moveWorkspacePath(root, stage, workspace)
      }
      await storage.assertWorkspaceDirectoryIdentity(root, workspace, record.directory!)
      record = { ...record, phase: 'published' }
      await storage.writeWorkspaceStorageRecord(workspace, record)
    }
    await storage.assertWorkspaceDirectoryIdentity(root, workspace, record.directory!)
    return record
  }

  private async commitRestore(root: string, workspace: string, initial: RestoreRecord): Promise<void> {
    let record = await this.finishRestore(root, workspace, initial)
    if (record.phase !== 'committed') {
      record = { ...record, phase: 'committed' }
      await storage.writeWorkspaceStorageRecord(workspace, record)
    }
    if (await storage.workspaceStat(`${workspace}.archiving`)) {
      throw new Error('Workspace has unverified archive residue')
    }
    await storage.removeEmptyWorkspaceStage(`${workspace}.restoring`)
    await storage.removeWorkspaceArtifact(root, `${workspace}.tar.gz.tmp`)
    await storage.removeWorkspaceArtifact(root, `${workspace}.storage.json.tmp`)
    await storage.removeWorkspaceArtifact(root, `${workspace}.tar.gz`)
    await storage.clearWorkspaceStorageRecord(workspace)
  }

  private async purge(workspace: Workspace): Promise<void> {
    const root = application.getPath('feature.agents.system_workspaces')
    const state = await this.inspect(root, workspace)
    if (!state || !this.workspaceStoragePaths(workspace.path).some(existsSync)) return
    const record: storage.WorkspaceStorageRecord =
      state.record?.operation === 'purge'
        ? state.record
        : {
            version: 1,
            operationId: randomUUID(),
            sessionId: workspace.id,
            operation: 'purge',
            phase: 'deleting'
          }
    await storage.writeWorkspaceStorageRecord(workspace.path, record)
    await this.quiesce(record.sessionId)
    for (const target of this.workspaceStoragePaths(workspace.path)) {
      if (target !== `${workspace.path}.storage.json`) await storage.removeWorkspaceArtifact(root, target)
    }
    await storage.clearWorkspaceStorageRecord(workspace.path)
  }
}

export const agentWorkspaceStorageService = new AgentWorkspaceStorageService()
