import fs from 'node:fs/promises'
import path from 'node:path'

import type { AbsoluteFilePath } from '@shared/types/file'

export type DshHomeHealth =
  | { healthy: true }
  | {
      healthy: false
      reason: 'projcache-unreadable' | 'projcache-version' | 'workspace-inconsistent' | 'workspace-unreadable'
      detail: string
    }

// Fail-open cap: an unexpectedly large store file is never a reason to block launch.
const MAX_ENTRY_BYTES = 256 * 1024

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function readStoreJson(storagesDir: AbsoluteFilePath, fileName: string): Promise<unknown | undefined> {
  const filePath = path.join(storagesDir, fileName)
  let stat: { size: number }
  try {
    stat = await fs.stat(filePath)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  if (stat.size > MAX_ENTRY_BYTES) return undefined
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
}

// Self-descriptive only: fires when the store's own version falls outside its own
// compatibleVersions. Anything else fails open — no Cherry-side version constants.
function checkProjcacheVersion(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const version = (data as { version?: unknown }).version
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return undefined
  const compatible = (data as { compatibleVersions?: unknown }).compatibleVersions
  if (!Array.isArray(compatible) || !compatible.every((entry) => typeof entry === 'number')) return undefined
  if (compatible.includes(version)) return undefined
  return `storages/session_projcache.json declares version ${version} outside its compatibleVersions [${compatible.join(', ')}]`
}

// Exact state from #20395: every workspace lost its sessionIds slots while the
// archive still holds sessions, which the dsh registry would not produce itself.
function checkWorkspaceConsistency(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const tables = (data as { tables?: unknown }).tables
  const workspaces =
    typeof tables === 'object' && tables !== null ? (tables as { workspaces?: unknown }).workspaces : undefined
  if (typeof workspaces !== 'object' || workspaces === null || Array.isArray(workspaces)) return undefined
  const entries = Object.values(workspaces)
  if (entries.length === 0) return undefined
  const global = (data as { global?: unknown }).global
  const archived =
    typeof global === 'object' && global !== null
      ? (global as { archivedSessionIds?: unknown }).archivedSessionIds
      : undefined
  if (!Array.isArray(archived) || archived.length === 0) return undefined
  const allEmpty = entries.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      Array.isArray((entry as { sessionIds?: unknown }).sessionIds) &&
      (entry as { sessionIds: unknown[] }).sessionIds.length === 0
  )
  if (!allEmpty) return undefined
  return (
    `storages/workspace.json lists ${entries.length} workspace(s) with empty sessionIds ` +
    `while archivedSessionIds holds ${archived.length} session(s)`
  )
}

/**
 * Read-only preflight for a pre-existing DSH home (`~/.dsh`, third-party owned).
 * @param storagesDir the registered `external.deepseek_harness.storages` directory.
 * @returns healthy, or the first positive incompatibility signal. Fail-open:
 * unknown shapes and I/O surprises report healthy so launch is never blocked.
 */
export async function checkDshHomeHealth(storagesDir: AbsoluteFilePath): Promise<DshHomeHealth> {
  let projcache: unknown
  try {
    projcache = await readStoreJson(storagesDir, 'session_projcache.json')
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        healthy: false,
        reason: 'projcache-unreadable',
        detail: 'storages/session_projcache.json is not valid JSON'
      }
    }
    return { healthy: true }
  }
  if (projcache !== undefined) {
    const versionDetail = checkProjcacheVersion(projcache)
    if (versionDetail) return { healthy: false, reason: 'projcache-version', detail: versionDetail }
  }

  let workspace: unknown
  try {
    workspace = await readStoreJson(storagesDir, 'workspace.json')
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { healthy: false, reason: 'workspace-unreadable', detail: 'storages/workspace.json is not valid JSON' }
    }
    return { healthy: true }
  }
  if (workspace !== undefined) {
    const consistencyDetail = checkWorkspaceConsistency(workspace)
    if (consistencyDetail) return { healthy: false, reason: 'workspace-inconsistent', detail: consistencyDetail }
  }
  return { healthy: true }
}
