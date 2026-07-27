import { constants } from 'node:fs'
import { copyFile, cp, lstat, mkdir, readdir, readlink, realpath, rmdir, stat, symlink, unlink } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  assertAgentStoragePath,
  ensureAgentDataDirectory,
  ensureAgentStorageDirectory
} from '@main/ai/agents/agentDataDirectory'
import { isPathInside } from '@main/utils/file'

const logger = loggerService.withContext('AgentsFilesystemMigration')
const IDENTITY_ENTRY_NAMES = new Set(['soul.md', 'user.md', 'memory'])

async function lstatIfExists(targetPath: string) {
  try {
    return await lstat(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  return path.normalize(childPath) === path.normalize(parentPath) || isPathInside(childPath, parentPath)
}

export interface AgentFileSessionPlan {
  sourceSessionId: string
  finalSessionId: string
  sourceAgentId: string
  finalAgentId: string
  sourceWorkspacePath: string
  isManagedDefault: boolean
  systemWorkspacePath?: string
  createdAt: number
  updatedAt: number
}

export interface LegacyAgentFilesCleanupPlan {
  agentsDataRoot: string
  workspaces: Array<{
    workspacePath: string
    entryNames: string[]
  }>
}

export function legacyAgentWorkspacePath(agentsDataRoot: string, legacyAgentId: string): string {
  const shortId = legacyAgentId.slice(-9)
  if (!shortId || shortId === '.' || shortId === '..' || /[\\/]/.test(shortId)) {
    throw new Error(`Invalid legacy agent id for workspace: ${legacyAgentId}`)
  }
  return path.join(agentsDataRoot, shortId)
}

/**
 * A lexical v1 default path is managed only when the directory itself is not
 * a symlink/junction. A symlinked v1 root is treated as an external user
 * workspace so migration never moves its target.
 */
export async function isManagedLegacyAgentWorkspace(
  agentsDataRoot: string,
  legacyAgentId: string,
  workspacePath: string
): Promise<boolean> {
  const expected = path.normalize(legacyAgentWorkspacePath(agentsDataRoot, legacyAgentId))
  if (path.normalize(workspacePath) !== expected || path.basename(expected) === 'system') return false

  const workspaceStat = await lstatIfExists(expected)
  if (!workspaceStat) return true
  if (workspaceStat.isSymbolicLink()) return false
  if (!workspaceStat.isDirectory()) return false

  const rootStat = await lstatIfExists(agentsDataRoot)
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return false
  const [realRoot, realWorkspace] = await Promise.all([realpath(agentsDataRoot), realpath(expected)])
  return isPathInsideOrEqual(realWorkspace, realRoot)
}

async function findCaseInsensitiveEntry(dir: string, name: string): Promise<string | undefined> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return undefined
  }
  const match = entries.find((entry) => entry.toLowerCase() === name.toLowerCase())
  return match ? path.join(dir, match) : undefined
}

async function materializeIdentityEntry(
  sourcePath: string,
  destinationPath: string,
  sourceWorkspaceRoot: string,
  visitedRealPaths = new Set<string>()
): Promise<boolean> {
  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink()) {
    let resolved: string
    try {
      resolved = await realpath(sourcePath)
    } catch (error) {
      logger.warn('Skipping unresolved identity symlink during agent migration', { sourcePath, error })
      return false
    }
    const realWorkspaceRoot = await realpath(sourceWorkspaceRoot)
    if (!isPathInsideOrEqual(resolved, realWorkspaceRoot) || resolved === realWorkspaceRoot) {
      logger.warn('Skipping identity symlink that points outside the legacy workspace', {
        sourcePath,
        resolved
      })
      return false
    }
    if (visitedRealPaths.has(resolved)) {
      logger.warn('Skipping cyclic identity symlink during agent migration', { sourcePath, resolved })
      return false
    }
    visitedRealPaths.add(resolved)
    const copied = await materializeIdentityEntry(resolved, destinationPath, sourceWorkspaceRoot, visitedRealPaths)
    visitedRealPaths.delete(resolved)
    return copied
  }

  const destinationStat = await lstatIfExists(destinationPath)
  if (sourceStat.isDirectory()) {
    if (destinationStat && (!destinationStat.isDirectory() || destinationStat.isSymbolicLink())) {
      logger.warn('Skipping identity directory because the target already exists with another type', {
        sourcePath,
        destinationPath
      })
      return false
    }
    if (!destinationStat) await mkdir(destinationPath)

    let complete = true
    for (const entry of await readdir(sourcePath)) {
      const copied = await materializeIdentityEntry(
        path.join(sourcePath, entry),
        path.join(destinationPath, entry),
        sourceWorkspaceRoot,
        visitedRealPaths
      )
      complete = copied && complete
    }
    return complete
  }

  if (!sourceStat.isFile()) {
    logger.warn('Skipping unsupported identity filesystem entry', { sourcePath })
    return false
  }
  if (destinationStat) {
    logger.warn('Skipping identity file because the target already exists', { sourcePath, destinationPath })
    return false
  }

  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
  return true
}

async function copyIdentityFromWorkspace(
  sourceWorkspacePath: string,
  agentDataPath: string,
  allowCleanup: boolean
): Promise<string[]> {
  const sourceStat = await lstatIfExists(sourceWorkspacePath)
  if (!sourceStat) return []

  let effectiveWorkspacePath = sourceWorkspacePath
  let canCleanup = allowCleanup
  if (sourceStat.isSymbolicLink()) {
    try {
      effectiveWorkspacePath = await realpath(sourceWorkspacePath)
      const resolvedStat = await lstat(effectiveWorkspacePath)
      if (!resolvedStat.isDirectory() || resolvedStat.isSymbolicLink()) {
        logger.warn('Skipping identity copy from symlinked legacy workspace whose target is not a real directory', {
          sourceWorkspacePath,
          effectiveWorkspacePath
        })
        return []
      }
      // A symlinked v1 root is an external user workspace. Read identity from
      // its resolved target, but never schedule any part of that target for cleanup.
      canCleanup = false
    } catch (error) {
      logger.warn('Skipping unresolved symlinked legacy workspace root', { sourceWorkspacePath, error })
      return []
    }
  } else if (!sourceStat.isDirectory()) {
    return []
  }

  const cleanupEntryNames: string[] = []
  for (const name of ['SOUL.md', 'USER.md', 'memory']) {
    const sourcePath = await findCaseInsensitiveEntry(effectiveWorkspacePath, name)
    if (!sourcePath) continue
    const copied = await materializeIdentityEntry(sourcePath, path.join(agentDataPath, name), effectiveWorkspacePath)
    if (copied && canCleanup) cleanupEntryNames.push(path.basename(sourcePath))
  }
  return cleanupEntryNames
}

async function removeTreeWithoutFollowing(targetPath: string): Promise<void> {
  const targetStat = await lstatIfExists(targetPath)
  if (!targetStat) return
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    await unlink(targetPath)
    return
  }
  for (const entry of await readdir(targetPath)) {
    await removeTreeWithoutFollowing(path.join(targetPath, entry))
  }
  await rmdir(targetPath)
}

async function copyWorkspaceEntryPreservingLinks(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink()) {
    const linkTarget = await readlink(sourcePath)
    let linkType: 'dir' | 'file' = 'file'
    try {
      if ((await stat(sourcePath)).isDirectory()) linkType = 'dir'
    } catch {
      // Dangling links retain their text and use the file default on Windows.
    }
    await symlink(linkTarget, destinationPath, linkType)
    return
  }
  if (sourceStat.isDirectory()) {
    await cp(sourcePath, destinationPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
      verbatimSymlinks: true
    })
    return
  }
  if (sourceStat.isFile()) {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    return
  }
  throw new Error(`Unsupported workspace entry: ${sourcePath}`)
}

async function copyWorkspaceEntry(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (await lstatIfExists(destinationPath)) {
    logger.warn('Leaving legacy workspace entry in place because the target exists', {
      sourcePath,
      destinationPath
    })
    return false
  }

  try {
    await copyWorkspaceEntryPreservingLinks(sourcePath, destinationPath)
    return true
  } catch (error) {
    await removeTreeWithoutFollowing(destinationPath).catch(() => undefined)
    logger.warn('Failed to copy legacy workspace entry; source was preserved', {
      sourcePath,
      destinationPath,
      error
    })
    return false
  }
}

async function copyOrdinaryWorkspaceContent(
  agentsDataRoot: string,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string
): Promise<string[]> {
  const sourceStat = await lstatIfExists(sourceWorkspacePath)
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) return []

  await ensureAgentStorageDirectory(agentsDataRoot, destinationWorkspacePath)
  const cleanupEntryNames: string[] = []
  for (const entry of await readdir(sourceWorkspacePath)) {
    if (IDENTITY_ENTRY_NAMES.has(entry.toLowerCase())) continue
    const copied = await copyWorkspaceEntry(
      path.join(sourceWorkspacePath, entry),
      path.join(destinationWorkspacePath, entry)
    )
    if (copied) cleanupEntryNames.push(entry)
  }
  return cleanupEntryNames
}

function addCleanupEntries(
  cleanupByWorkspace: Map<string, Set<string>>,
  workspacePath: string,
  entryNames: string[]
): void {
  if (entryNames.length === 0) return
  const entries = cleanupByWorkspace.get(workspacePath) ?? new Set<string>()
  for (const entryName of entryNames) entries.add(entryName)
  cleanupByWorkspace.set(workspacePath, entries)
}

export async function stageLegacyAgentFiles(input: {
  agentsDataRoot: string
  agents: Array<{ sourceAgentId: string; finalAgentId: string }>
  sessions: AgentFileSessionPlan[]
}): Promise<LegacyAgentFilesCleanupPlan> {
  const cleanupByWorkspace = new Map<string, Set<string>>()
  const plansByAgent = new Map<string, AgentFileSessionPlan[]>()
  for (const session of input.sessions) {
    const plans = plansByAgent.get(session.sourceAgentId) ?? []
    plans.push(session)
    plansByAgent.set(session.sourceAgentId, plans)
  }

  for (const { sourceAgentId, finalAgentId } of input.agents) {
    const agentPlans = plansByAgent.get(sourceAgentId) ?? []
    const agentDataPath = await ensureAgentDataDirectory(input.agentsDataRoot, finalAgentId, {
      createFiles: false
    })
    const defaultWorkspacePath = legacyAgentWorkspacePath(input.agentsDataRoot, sourceAgentId)

    const orderedSources = [...agentPlans]
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          right.createdAt - left.createdAt ||
          left.sourceSessionId.localeCompare(right.sourceSessionId)
      )
      .map((plan) => ({
        path: plan.sourceWorkspacePath,
        remove: plan.isManagedDefault && path.resolve(plan.sourceWorkspacePath) === path.resolve(defaultWorkspacePath)
      }))
    orderedSources.push({ path: defaultWorkspacePath, remove: true })

    const seenSources = new Set<string>()
    for (const source of orderedSources) {
      const normalizedSource = path.resolve(source.path)
      if (seenSources.has(normalizedSource) || normalizedSource === path.resolve(agentDataPath)) continue
      seenSources.add(normalizedSource)
      const copiedEntries = await copyIdentityFromWorkspace(source.path, agentDataPath, source.remove)
      if (source.remove) addCleanupEntries(cleanupByWorkspace, source.path, copiedEntries)
    }

    await ensureAgentDataDirectory(input.agentsDataRoot, finalAgentId)

    const systemSessions = agentPlans.filter((plan) => plan.isManagedDefault && plan.systemWorkspacePath)
    for (const session of systemSessions) {
      if (session.systemWorkspacePath) {
        await ensureAgentStorageDirectory(input.agentsDataRoot, session.systemWorkspacePath)
      }
    }

    const latestSystemSession = systemSessions.sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.createdAt - left.createdAt ||
        left.sourceSessionId.localeCompare(right.sourceSessionId)
    )[0]
    if (
      latestSystemSession?.systemWorkspacePath &&
      path.resolve(defaultWorkspacePath) !== path.resolve(agentDataPath)
    ) {
      const copiedEntries = await copyOrdinaryWorkspaceContent(
        input.agentsDataRoot,
        defaultWorkspacePath,
        latestSystemSession.systemWorkspacePath
      )
      addCleanupEntries(cleanupByWorkspace, defaultWorkspacePath, copiedEntries)
    }
  }

  return {
    agentsDataRoot: input.agentsDataRoot,
    workspaces: Array.from(cleanupByWorkspace, ([workspacePath, entryNames]) => ({
      workspacePath,
      entryNames: Array.from(entryNames)
    }))
  }
}

/**
 * Remove only source entries that were successfully copied during staging.
 * Called after the engine has verified all migrators and persisted its
 * completed marker. Failures are safe to retry or leave as v1 residue.
 */
export async function cleanupLegacyAgentFiles(plan: LegacyAgentFilesCleanupPlan): Promise<void> {
  for (const workspace of plan.workspaces) {
    const workspaceStat = await lstatIfExists(workspace.workspacePath)
    if (!workspaceStat) continue
    if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
      logger.warn('Skipping legacy agent cleanup because the workspace root is no longer a real directory', {
        workspacePath: workspace.workspacePath
      })
      continue
    }

    await assertAgentStoragePath(plan.agentsDataRoot, workspace.workspacePath)
    for (const entryName of workspace.entryNames) {
      if (!entryName || entryName === '.' || entryName === '..' || /[\\/]/.test(entryName)) {
        logger.warn('Skipping invalid legacy agent cleanup entry', {
          workspacePath: workspace.workspacePath,
          entryName
        })
        continue
      }
      await removeTreeWithoutFollowing(path.join(workspace.workspacePath, entryName))
    }
    await rmdir(workspace.workspacePath).catch(() => undefined)
  }
}
