import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, openSync, realpathSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { createPathOverlapCheck, nearestExistingRealPathSync, type PathNameBehavior } from '@main/utils/file'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import { WORKSPACE_ARCHIVE_SUFFIXES } from './agentWorkspaceArchive'

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
    const owners = (typeof ownerPaths === 'string' ? [ownerPaths] : ownerPaths).map(nearestExistingRealPathSync)
    const claims = agentWorkspaceService
      .listStorageClaims()
      .filter(
        (row) => row.type !== AGENT_WORKSPACE_TYPE.SYSTEM || !owners.includes(nearestExistingRealPathSync(row.path))
      )
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
    return ['', ...WORKSPACE_ARCHIVE_SUFFIXES].map((suffix) => `${workspace}${suffix}`)
  }

  async withSystemWorkspaceStorage<T>(
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
}

export const agentWorkspaceStorageService = new AgentWorkspaceStorageService()
