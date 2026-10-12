import { realpathSync } from 'node:fs'
import path from 'node:path'

import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import { WORKSPACE_ARCHIVE_SUFFIXES } from './agentWorkspaceArchive'

function canonicalWorkspacePath(value: string): string {
  let current = path.resolve(value)
  const missing: string[] = []
  while (true) {
    try {
      current = path.join(realpathSync.native(current), ...missing)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) break
      missing.unshift(path.basename(current))
      current = parent
    }
  }
  return process.platform === 'win32' ? current.toLowerCase() : current
}

function workspacePathsOverlap(left: string, right: string): boolean {
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child)
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  }
  return contains(left, right) || contains(right, left)
}

const storageReservations = new Set<readonly string[]>()

export function reserveWorkspaceStorage(paths: readonly string[], ownerPath?: string): (() => void) | undefined {
  const targets = paths.map(canonicalWorkspacePath)
  const owner = ownerPath === undefined ? undefined : canonicalWorkspacePath(ownerPath)
  const rows = agentWorkspaceService.listStorageClaims()
  for (const row of rows) {
    const claimed = canonicalWorkspacePath(row.path)
    if (row.type === AGENT_WORKSPACE_TYPE.SYSTEM && claimed === owner) continue
    if (targets.some((target) => workspacePathsOverlap(target, claimed))) return undefined
  }
  if (
    [...storageReservations].some((reserved) =>
      reserved.some((claim) => targets.some((target) => workspacePathsOverlap(target, claim)))
    )
  )
    return undefined
  storageReservations.add(targets)
  return () => {
    storageReservations.delete(targets)
  }
}

function assertStorageAvailable(workspacePath: string): void {
  const target = canonicalWorkspacePath(workspacePath)
  if ([...storageReservations].some((reserved) => reserved.some((claim) => workspacePathsOverlap(target, claim)))) {
    throw DataApiErrorFactory.conflict(
      'Workspace storage is being archived or reclaimed; retry after the operation completes',
      'Workspace'
    )
  }
}

export function registerAgentWorkspace(workspacePath: string, options: { name?: string } = {}) {
  assertStorageAvailable(workspacePath.trim())
  return agentWorkspaceService.findOrCreateByPathResult(workspacePath, options)
}

export async function withSystemWorkspaceStorage<T>(
  workspace: string,
  operation: () => Promise<T>,
  orphan = false
): Promise<T | undefined> {
  const release = reserveWorkspaceStorage(
    ['', ...WORKSPACE_ARCHIVE_SUFFIXES].map((suffix) => `${workspace}${suffix}`),
    orphan ? undefined : workspace
  )
  if (!release) return undefined
  try {
    return await operation()
  } finally {
    release()
  }
}
