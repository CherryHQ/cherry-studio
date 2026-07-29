import { createHash, type Hash, randomUUID } from 'node:crypto'
import { type BigIntStats, constants, createReadStream } from 'node:fs'
import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rmdir,
  stat,
  symlink,
  unlink
} from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  agentDataDirectoryPath,
  ensureAgentDataDirectory,
  ensureAgentStorageDirectory
} from '@main/ai/agents/agentDataDirectory'
import { isWin } from '@main/core/platform'
import { isPathInside } from '@main/utils/file'
import { validate as isUuid } from 'uuid'

const logger = loggerService.withContext('AgentsFilesystemMigration')
const IDENTITY_ENTRY_NAMES = new Set(['soul.md', 'user.md', 'memory'])
const CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH = 200

function canonicalIdentityEntryName(name: string): string | undefined {
  switch (name.toLowerCase()) {
    case 'soul.md':
      return 'SOUL.md'
    case 'user.md':
      return 'USER.md'
    case 'memory':
      return 'memory'
    default:
      return undefined
  }
}

async function lstatIfExists(targetPath: string) {
  try {
    return await lstat(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function lstatBigIntIfExists(targetPath: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(targetPath, { bigint: true })
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
  latestRuntimeResumeToken?: string
  runtimeResumeTokens: string[]
  createdAt: number
  updatedAt: number
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

type MaterializedEntryKind = 'identity' | 'skill'

async function materializeContainedEntry(
  sourcePath: string,
  destinationPath: string,
  sourceWorkspaceRoot: string,
  entryKind: MaterializedEntryKind,
  visitedRealPaths = new Set<string>()
): Promise<boolean> {
  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink()) {
    let resolved: string
    try {
      resolved = await realpath(sourcePath)
    } catch (error) {
      logger.warn(`Skipping unresolved ${entryKind} symlink during Agent migration`, { sourcePath, error })
      return false
    }
    const realWorkspaceRoot = await realpath(sourceWorkspaceRoot)
    if (!isPathInsideOrEqual(resolved, realWorkspaceRoot) || resolved === realWorkspaceRoot) {
      logger.warn(`Skipping ${entryKind} symlink that points outside its allowed root`, {
        sourcePath,
        resolved
      })
      return false
    }
    if (visitedRealPaths.has(resolved)) {
      logger.warn(`Skipping cyclic ${entryKind} symlink during Agent migration`, { sourcePath, resolved })
      return false
    }
    visitedRealPaths.add(resolved)
    const copied = await materializeContainedEntry(
      resolved,
      destinationPath,
      sourceWorkspaceRoot,
      entryKind,
      visitedRealPaths
    )
    visitedRealPaths.delete(resolved)
    return copied
  }

  if (sourceStat.isDirectory()) {
    await mkdir(destinationPath)

    let complete = true
    for (const entry of await readdir(sourcePath)) {
      const copied = await materializeContainedEntry(
        path.join(sourcePath, entry),
        path.join(destinationPath, entry),
        sourceWorkspaceRoot,
        entryKind,
        visitedRealPaths
      )
      complete = copied && complete
    }
    return complete
  }

  if (!sourceStat.isFile()) {
    logger.warn(`Skipping unsupported ${entryKind} filesystem entry`, { sourcePath })
    return false
  }

  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
  return true
}

async function copyMaterializedEntry(
  sourcePath: string,
  destinationPath: string,
  sourceWorkspaceRoot: string,
  entryKind: MaterializedEntryKind
): Promise<boolean> {
  const sourceSnapshot = await materializedCopySourceSnapshot(sourcePath, sourceWorkspaceRoot)
  if (!sourceSnapshot) return false

  const stagingPrefix = `.${path.basename(destinationPath)}.migration-`
  const stagingPath = path.join(path.dirname(destinationPath), `${stagingPrefix}${randomUUID()}`)

  try {
    if (!(await materializeContainedEntry(sourcePath, stagingPath, sourceWorkspaceRoot, entryKind))) {
      throw new Error(`Legacy Agent ${entryKind} changed while being copied: ${sourcePath}`)
    }

    const sourceMetadataFingerprint = await materializedSourceMetadataFingerprint(sourcePath, sourceWorkspaceRoot)
    if (sourceMetadataFingerprint !== sourceSnapshot.metadataFingerprint) {
      throw new Error(`Legacy Agent ${entryKind} changed while being copied: ${sourcePath}`)
    }

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent ${entryKind} copy verification failed: ${sourcePath}`)
    }

    let destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
    if (destinationSnapshot) {
      if (destinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
        throw new Error(`Legacy Agent ${entryKind} destination conflict: ${destinationPath}`)
      }
      logger.info(`Reusing identical ${entryKind} entry from an earlier migration attempt`, {
        sourcePath,
        destinationPath
      })
    } else {
      try {
        await publishStagedWorkspaceEntry(stagingPath, destinationPath)
      } catch (error) {
        destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
        if (!destinationSnapshot || destinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
          throw error
        }
      }
      destinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
    }

    if (destinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent ${entryKind} changed while being published: ${destinationPath}`)
    }
    return true
  } finally {
    await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
  }
}

async function copyIdentityFromWorkspace(
  sourceWorkspacePath: string,
  agentDataPath: string,
  claimedIdentityEntries: Set<string>
): Promise<void> {
  const sourceStat = await lstatIfExists(sourceWorkspacePath)
  if (!sourceStat) return

  let effectiveWorkspacePath = sourceWorkspacePath
  if (sourceStat.isSymbolicLink()) {
    try {
      effectiveWorkspacePath = await realpath(sourceWorkspacePath)
      const resolvedStat = await lstat(effectiveWorkspacePath)
      if (!resolvedStat.isDirectory() || resolvedStat.isSymbolicLink()) {
        logger.warn('Skipping identity copy from symlinked legacy workspace whose target is not a real directory', {
          sourceWorkspacePath,
          effectiveWorkspacePath
        })
        return
      }
      // A symlinked v1 root is an external user workspace. Read identity from
      // its resolved target without modifying the user-owned workspace.
    } catch (error) {
      logger.warn('Skipping unresolved symlinked legacy workspace root', { sourceWorkspacePath, error })
      return
    }
  } else if (!sourceStat.isDirectory()) {
    return
  }

  for (const name of ['SOUL.md', 'USER.md', 'memory']) {
    if (claimedIdentityEntries.has(name)) continue
    const sourcePath = await findCaseInsensitiveEntry(effectiveWorkspacePath, name)
    if (!sourcePath) continue
    const destinationPath = path.join(agentDataPath, name)
    if (await copyMaterializedEntry(sourcePath, destinationPath, effectiveWorkspacePath, 'identity')) {
      claimedIdentityEntries.add(name)
    }
  }
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

/**
 * Copy the v1 global Claude Agent SDK config into its v2 Agent-data location.
 * The source remains intact for downgrade compatibility. Publication is
 * atomic, an existing destination directory is left untouched, and symlinks
 * are skipped so the copy does not require Windows symlink privileges.
 */
export async function copyLegacyClaudeConfig(sourcePath: string, destinationPath: string): Promise<boolean> {
  const destinationStat = await lstatIfExists(destinationPath)
  if (destinationStat?.isDirectory() && !destinationStat.isSymbolicLink()) {
    logger.info('Skipping legacy Claude config migration because the destination directory already exists', {
      sourcePath,
      destinationPath
    })
    return false
  }

  const sourceStat = await lstatIfExists(sourcePath)
  if (!sourceStat) return false
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Legacy Claude config source is not a directory: ${sourcePath}`)
  }

  const sourceSnapshot = await requiredFilesystemEntrySnapshot(sourcePath, true)
  const sourceMetadataFingerprint = await filesystemEntryMetadataFingerprint(sourcePath)
  if (!sourceMetadataFingerprint) {
    throw new Error(`Legacy Claude config source disappeared: ${sourcePath}`)
  }

  await mkdir(path.dirname(destinationPath), { recursive: true })
  const stagingPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.migration-${randomUUID()}`
  )

  try {
    await cp(sourcePath, stagingPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
      filter: async (entryPath) => {
        if (!(await lstat(entryPath)).isSymbolicLink()) return true
        logger.warn('Skipping symlink while copying legacy Claude config', { entryPath })
        return false
      }
    })

    if ((await filesystemEntryMetadataFingerprint(sourcePath)) !== sourceMetadataFingerprint) {
      throw new Error(`Legacy Claude config changed while being copied: ${sourcePath}`)
    }

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
      throw new Error(`Legacy Claude config copy verification failed: ${sourcePath}`)
    }

    let destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
    if (destinationSnapshot) {
      if (destinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
        throw new Error(`Legacy Claude config destination conflict: ${destinationPath}`)
      }
      logger.info('Reusing identical Claude config from an earlier migration attempt', {
        sourcePath,
        destinationPath
      })
    } else {
      try {
        await publishStagedWorkspaceEntry(stagingPath, destinationPath)
      } catch (error) {
        destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
        if (!destinationSnapshot || destinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
          throw error
        }
      }
      destinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
    }

    if (destinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
      throw new Error(`Legacy Claude config changed while being published: ${destinationPath}`)
    }

    logger.info('Copied legacy Claude config into the v2 Agents data directory', {
      sourcePath,
      destinationPath
    })
    return true
  } finally {
    await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
  }
}

function claudeProjectDirectoryNameHash(workspacePath: string): string {
  let hash = 0
  for (let index = 0; index < workspacePath.length; index++) {
    hash = ((hash << 5) - hash + workspacePath.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * Mirror Claude Agent SDK 0.3.218's private cwd-to-project-directory mapping.
 * Session lookup is scoped to this directory when the runtime passes `cwd`, so
 * a moved workspace needs its transcript copied under the new key.
 */
export function claudeProjectDirectoryName(workspacePath: string): string {
  const sanitized = workspacePath.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH) return sanitized
  return `${sanitized.slice(0, CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH)}-${claudeProjectDirectoryNameHash(workspacePath)}`
}

async function claudeProjectDirectoryPath(projectsDirectory: string, workspacePath: string): Promise<string> {
  let resolvedWorkspacePath: string
  try {
    resolvedWorkspacePath = path.normalize(await realpath(workspacePath))
  } catch {
    resolvedWorkspacePath = path.resolve(workspacePath)
  }
  return path.join(projectsDirectory, claudeProjectDirectoryName(resolvedWorkspacePath))
}

interface ClaudeSessionSource {
  transcriptPath: string
}

async function existingClaudeProjectsDirectories(projectsDirectories: string[]): Promise<string[]> {
  const existingDirectories: string[] = []
  const seenDirectories = new Set<string>()

  for (const projectsDirectory of projectsDirectories) {
    const normalizedProjectsDirectory = path.resolve(projectsDirectory)
    if (seenDirectories.has(normalizedProjectsDirectory)) continue
    seenDirectories.add(normalizedProjectsDirectory)

    const projectsStat = await lstatIfExists(normalizedProjectsDirectory)
    if (projectsStat?.isDirectory() && !projectsStat.isSymbolicLink()) {
      existingDirectories.push(normalizedProjectsDirectory)
    }
  }

  return existingDirectories
}

async function expectedClaudeProjectDirectories(
  projectsDirectories: string[],
  workspacePath: string
): Promise<string[]> {
  let resolvedWorkspacePath: string
  try {
    resolvedWorkspacePath = path.normalize(await realpath(workspacePath))
  } catch {
    resolvedWorkspacePath = path.resolve(workspacePath)
  }

  const projectDirectoryName = claudeProjectDirectoryName(resolvedWorkspacePath)
  const existingDirectories: string[] = []
  for (const projectsDirectory of projectsDirectories) {
    const projectDirectory = path.join(projectsDirectory, projectDirectoryName)
    const projectStat = await lstatIfExists(projectDirectory)
    if (projectStat?.isDirectory() && !projectStat.isSymbolicLink()) {
      existingDirectories.push(projectDirectory)
    }
  }
  return existingDirectories
}

async function findClaudeSessionSourceInProjectDirectory(
  projectDirectory: string,
  runtimeResumeToken: string
): Promise<ClaudeSessionSource | undefined> {
  const transcriptPath = path.join(projectDirectory, `${runtimeResumeToken}.jsonl`)
  const transcriptStat = await lstatIfExists(transcriptPath)
  if (!transcriptStat?.isFile() || transcriptStat.isSymbolicLink()) return undefined

  return { transcriptPath }
}

async function findClaudeSessionSourceInExpectedProjects(
  projectDirectories: string[],
  runtimeResumeToken: string
): Promise<ClaudeSessionSource | undefined> {
  for (const projectDirectory of projectDirectories) {
    const source = await findClaudeSessionSourceInProjectDirectory(projectDirectory, runtimeResumeToken)
    if (source) return source
  }

  return undefined
}

async function findClaudeSessionSourcesGlobally(
  projectsDirectories: string[],
  runtimeResumeTokens: Set<string>
): Promise<Map<string, ClaudeSessionSource>> {
  const sources = new Map<string, ClaudeSessionSource>()

  for (const projectsDirectory of projectsDirectories) {
    const projectEntries = await readdir(projectsDirectory, { withFileTypes: true })
    projectEntries.sort((left, right) => left.name.localeCompare(right.name))
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) continue
      const projectDirectory = path.join(projectsDirectory, projectEntry.name)
      const sessionEntries = await readdir(projectDirectory, { withFileTypes: true })
      sessionEntries.sort((left, right) => left.name.localeCompare(right.name))

      for (const sessionEntry of sessionEntries) {
        if (!sessionEntry.isFile() || !sessionEntry.name.endsWith('.jsonl')) continue
        const runtimeResumeToken = sessionEntry.name.slice(0, -'.jsonl'.length)
        if (!runtimeResumeTokens.has(runtimeResumeToken) || sources.has(runtimeResumeToken)) continue

        sources.set(runtimeResumeToken, {
          transcriptPath: path.join(projectDirectory, sessionEntry.name)
        })
      }

      if (sources.size === runtimeResumeTokens.size) return sources
    }
  }

  return sources
}

async function copyClaudeSessionEntry(sourcePath: string, destinationPath: string): Promise<boolean> {
  const sourceStat = await lstatIfExists(sourcePath)
  if (!sourceStat) {
    throw new Error(`Legacy Claude session cache disappeared: ${sourcePath}`)
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Legacy Claude session cache is not a regular file: ${sourcePath}`)
  }

  const sourceSnapshot = await requiredFilesystemEntrySnapshot(sourcePath, true)
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) return false
  const sourceMetadataFingerprint = await filesystemEntryMetadataFingerprint(sourcePath)
  if (!sourceMetadataFingerprint) {
    throw new Error(`Legacy Claude session cache disappeared: ${sourcePath}`)
  }

  const stagingPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.migration-${randomUUID()}`
  )
  try {
    await copyFile(sourcePath, stagingPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)

    if ((await filesystemEntryMetadataFingerprint(sourcePath)) !== sourceMetadataFingerprint) {
      throw new Error(`Legacy Claude session cache changed while being copied: ${sourcePath}`)
    }

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
      throw new Error(`Legacy Claude session cache copy verification failed: ${sourcePath}`)
    }

    let destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
    if (destinationSnapshot) {
      if (destinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
        throw new Error(`Legacy Claude session cache destination conflict: ${destinationPath}`)
      }
      logger.info('Reusing identical Claude session cache entry from an earlier migration attempt', {
        sourcePath,
        destinationPath
      })
    } else {
      try {
        await publishStagedWorkspaceEntry(stagingPath, destinationPath)
      } catch (error) {
        destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
        if (!destinationSnapshot || destinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
          throw error
        }
      }
      destinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
    }

    if (destinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
      throw new Error(`Legacy Claude session cache changed while being published: ${destinationPath}`)
    }
    return true
  } finally {
    await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
  }
}

/**
 * Make validated Claude SDK session transcripts available under each v2
 * workspace key. The old project cache remains intact for downgrade and GC;
 * only the JSONL transcript is copied.
 */
export async function copyLegacyClaudeSessionData(input: {
  agentsDataRoot: string
  sourceProjectsDirectories: string[]
  destinationProjectsDirectory: string
  sessions: AgentFileSessionPlan[]
}): Promise<void> {
  const copyPlans: Array<{
    sourceSessionId: string
    runtimeResumeToken: string
    sourceWorkspacePath: string
    destinationWorkspacePath: string
  }> = []
  const requestedTokens = new Set<string>()

  for (const session of input.sessions) {
    const destinationWorkspacePath = session.isManagedDefault
      ? session.systemWorkspacePath
      : session.sourceWorkspacePath
    if (!destinationWorkspacePath) continue

    for (const runtimeResumeToken of session.runtimeResumeTokens) {
      if (!isUuid(runtimeResumeToken)) {
        logger.warn('Skipping invalid Claude runtime resume token during Agent migration', {
          sourceSessionId: session.sourceSessionId,
          runtimeResumeToken
        })
        continue
      }
      requestedTokens.add(runtimeResumeToken)
      copyPlans.push({
        sourceSessionId: session.sourceSessionId,
        runtimeResumeToken,
        sourceWorkspacePath: session.sourceWorkspacePath,
        destinationWorkspacePath
      })
    }
  }

  if (requestedTokens.size === 0) return

  const sourceProjectsDirectories = await existingClaudeProjectsDirectories(input.sourceProjectsDirectories)
  const projectDirectoriesByWorkspace = new Map<string, string[]>()
  const expectedSources = new Map<string, ClaudeSessionSource | undefined>()
  const sourcesByCopyPlan: Array<ClaudeSessionSource | undefined> = []
  const globallyUnresolvedTokens = new Set<string>()
  for (const copyPlan of copyPlans) {
    const sourceKey = `${copyPlan.sourceWorkspacePath}\0${copyPlan.runtimeResumeToken}`
    let source = expectedSources.get(sourceKey)
    if (!expectedSources.has(sourceKey)) {
      const workspaceKey = path.resolve(copyPlan.sourceWorkspacePath)
      let projectDirectories = projectDirectoriesByWorkspace.get(workspaceKey)
      if (!projectDirectories) {
        projectDirectories = await expectedClaudeProjectDirectories(
          sourceProjectsDirectories,
          copyPlan.sourceWorkspacePath
        )
        projectDirectoriesByWorkspace.set(workspaceKey, projectDirectories)
      }
      source = await findClaudeSessionSourceInExpectedProjects(projectDirectories, copyPlan.runtimeResumeToken)
      expectedSources.set(sourceKey, source)
    }
    sourcesByCopyPlan.push(source)
    if (!source) globallyUnresolvedTokens.add(copyPlan.runtimeResumeToken)
  }

  const globallyDiscoveredSources =
    globallyUnresolvedTokens.size === 0
      ? new Map<string, ClaudeSessionSource>()
      : await findClaudeSessionSourcesGlobally(sourceProjectsDirectories, globallyUnresolvedTokens)
  const latestTokensBySessionId = new Map(
    input.sessions
      .filter((session) => session.latestRuntimeResumeToken)
      .map((session) => [session.sourceSessionId, session.latestRuntimeResumeToken!])
  )
  const resolvedSourcesByCopyPlan = copyPlans.map(
    (copyPlan, index) => sourcesByCopyPlan[index] ?? globallyDiscoveredSources.get(copyPlan.runtimeResumeToken)
  )
  const resumableSessionIds = new Set<string>()
  for (const [copyPlanIndex, copyPlan] of copyPlans.entries()) {
    const source = resolvedSourcesByCopyPlan[copyPlanIndex]
    if (!source) {
      logger.warn('Claude session transcript not found during Agent migration', {
        sourceSessionId: copyPlan.sourceSessionId,
        runtimeResumeToken: copyPlan.runtimeResumeToken
      })
      continue
    }
    if (latestTokensBySessionId.get(copyPlan.sourceSessionId) === copyPlan.runtimeResumeToken) {
      resumableSessionIds.add(copyPlan.sourceSessionId)
    }
  }

  const destinationDirectoriesByWorkspace = new Map<string, string>()
  const preparedDestinationDirectories = new Set<string>()
  let preparedEntries = 0

  for (const [copyPlanIndex, copyPlan] of copyPlans.entries()) {
    if (!resumableSessionIds.has(copyPlan.sourceSessionId)) continue
    const source = resolvedSourcesByCopyPlan[copyPlanIndex]
    if (!source) continue

    let destinationProjectDirectory = destinationDirectoriesByWorkspace.get(copyPlan.destinationWorkspacePath)
    if (!destinationProjectDirectory) {
      destinationProjectDirectory = await claudeProjectDirectoryPath(
        input.destinationProjectsDirectory,
        copyPlan.destinationWorkspacePath
      )
      destinationDirectoriesByWorkspace.set(copyPlan.destinationWorkspacePath, destinationProjectDirectory)
    }

    if (!preparedDestinationDirectories.has(destinationProjectDirectory)) {
      await ensureAgentStorageDirectory(input.agentsDataRoot, destinationProjectDirectory)
      preparedDestinationDirectories.add(destinationProjectDirectory)
    }

    if (
      await copyClaudeSessionEntry(
        source.transcriptPath,
        path.join(destinationProjectDirectory, `${copyPlan.runtimeResumeToken}.jsonl`)
      )
    ) {
      preparedEntries++
    }
  }

  logger.info('Prepared Claude session cache for migrated Agent workspace paths', {
    requestedSessions: copyPlans.length,
    preparedEntries
  })
}

function migratedLinkTarget(
  sourceLinkPath: string,
  destinationLinkPath: string,
  linkTarget: string,
  sourceWorkspaceRoot: string,
  destinationWorkspaceRoot: string,
  agentDataPath: string
): string {
  const sourceTarget = path.isAbsolute(linkTarget)
    ? path.normalize(linkTarget)
    : path.resolve(path.dirname(sourceLinkPath), linkTarget)
  let migratedTarget = sourceTarget
  if (isPathInsideOrEqual(sourceTarget, sourceWorkspaceRoot)) {
    const relativeTarget = path.relative(sourceWorkspaceRoot, sourceTarget)
    const [firstSegment, ...remainingSegments] = relativeTarget.split(path.sep)
    const identityEntryName = canonicalIdentityEntryName(firstSegment)
    migratedTarget = identityEntryName
      ? path.join(agentDataPath, identityEntryName, ...remainingSegments)
      : path.join(destinationWorkspaceRoot, relativeTarget)
  }

  if (path.isAbsolute(linkTarget)) return migratedTarget
  const relativeTarget = path.relative(path.dirname(destinationLinkPath), migratedTarget)
  return path.isAbsolute(relativeTarget) ? migratedTarget : relativeTarget || '.'
}

type WorkspaceLinkType = 'dir' | 'file'

async function workspaceLinkType(sourcePath: string): Promise<WorkspaceLinkType> {
  try {
    return (await stat(sourcePath)).isDirectory() ? 'dir' : 'file'
  } catch {
    // Dangling links retain their text and use the file default on Windows.
    return 'file'
  }
}

function copiedWorkspaceLinkTarget(
  migratedTarget: string,
  finalDestinationPath: string,
  linkType: WorkspaceLinkType
): string {
  if (!isWin || linkType !== 'dir') return migratedTarget
  return path.resolve(path.dirname(finalDestinationPath), migratedTarget)
}

async function createWorkspaceLink(linkTarget: string, linkPath: string, linkType: WorkspaceLinkType): Promise<void> {
  if (!isWin || linkType !== 'dir') {
    await symlink(linkTarget, linkPath, linkType)
    return
  }

  try {
    await symlink(linkTarget, linkPath, 'junction')
  } catch {
    // Junctions avoid Windows symlink privileges but cannot represent every
    // directory target, including network shares. Preserve those as dir links.
    await symlink(linkTarget, linkPath, 'dir')
  }
}

async function copyWorkspaceLink(
  sourcePath: string,
  copiedPath: string,
  finalDestinationPath: string,
  sourceWorkspaceRoot: string,
  destinationWorkspaceRoot: string,
  agentDataPath: string
): Promise<void> {
  const linkTarget = await readlink(sourcePath)
  const linkType = await workspaceLinkType(sourcePath)
  const migratedTarget = migratedLinkTarget(
    sourcePath,
    finalDestinationPath,
    linkTarget,
    sourceWorkspaceRoot,
    destinationWorkspaceRoot,
    agentDataPath
  )
  await mkdir(path.dirname(copiedPath), { recursive: true })
  await createWorkspaceLink(
    copiedWorkspaceLinkTarget(migratedTarget, finalDestinationPath, linkType),
    copiedPath,
    linkType
  )
}

async function copyWorkspaceEntryPreservingLinks(
  sourcePath: string,
  destinationPath: string,
  finalDestinationPath: string,
  sourceWorkspaceRoot: string,
  destinationWorkspaceRoot: string,
  agentDataPath: string
): Promise<void> {
  const links: Array<{ sourcePath: string; copiedPath: string; finalDestinationPath: string }> = []
  await cp(sourcePath, destinationPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
    filter: async (entrySourcePath, entryCopiedPath) => {
      const entryStat = await lstat(entrySourcePath)
      if (!entryStat.isSymbolicLink()) return true
      links.push({
        sourcePath: entrySourcePath,
        copiedPath: entryCopiedPath,
        finalDestinationPath: path.join(finalDestinationPath, path.relative(sourcePath, entrySourcePath))
      })
      return false
    }
  })
  for (const linkPlan of links) {
    await copyWorkspaceLink(
      linkPlan.sourcePath,
      linkPlan.copiedPath,
      linkPlan.finalDestinationPath,
      sourceWorkspaceRoot,
      destinationWorkspaceRoot,
      agentDataPath
    )
  }
}

type FilesystemEntryKind = 'directory' | 'file' | 'symlink'

interface FilesystemEntrySnapshot {
  fingerprint: string
}

interface CopySourceSnapshot {
  copiedFingerprint: string
  metadataFingerprint: string
  linkType?: WorkspaceLinkType
}

function filesystemEntryKind(targetStat: BigIntStats): FilesystemEntryKind {
  if (targetStat.isSymbolicLink()) return 'symlink'
  if (targetStat.isFile()) return 'file'
  if (targetStat.isDirectory()) return 'directory'
  throw new Error('Unsupported Agent migration fingerprint entry type')
}

function updateFingerprintField(hash: Hash, value: string): void {
  hash.update(`${Buffer.byteLength(value)}:`)
  hash.update(value)
}

function filesystemEntryMetadataToken(targetStat: BigIntStats): string {
  return [targetStat.dev, targetStat.ino, targetStat.size, targetStat.mtimeNs, targetStat.ctimeNs].join(':')
}

async function assertFilesystemEntryUnchanged(targetPath: string, initialStat: BigIntStats): Promise<void> {
  const finalStat = await lstatBigIntIfExists(targetPath)
  if (
    !finalStat ||
    filesystemEntryKind(finalStat) !== filesystemEntryKind(initialStat) ||
    filesystemEntryMetadataToken(finalStat) !== filesystemEntryMetadataToken(initialStat)
  ) {
    throw new Error(`Agent migration fingerprint entry changed while being read: ${targetPath}`)
  }
}

function initializeMetadataFingerprint(targetStat: BigIntStats): Hash {
  const hash = createHash('sha256')
  updateFingerprintField(hash, filesystemEntryKind(targetStat))
  updateFingerprintField(hash, filesystemEntryMetadataToken(targetStat))
  return hash
}

async function filesystemEntrySnapshot(
  targetPath: string,
  skipSymlinks = false
): Promise<FilesystemEntrySnapshot | undefined> {
  const targetStat = await lstatBigIntIfExists(targetPath)
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  if (skipSymlinks && kind === 'symlink') return undefined

  const contentHash = createHash('sha256')
  updateFingerprintField(contentHash, kind)

  if (kind === 'symlink') {
    updateFingerprintField(contentHash, await readlink(targetPath))
  } else if (kind === 'file') {
    for await (const chunk of createReadStream(targetPath)) {
      contentHash.update(chunk)
    }
  } else {
    const entries = await readdir(targetPath)
    entries.sort()
    for (const entry of entries) {
      const childPath = path.join(targetPath, entry)
      const childSnapshot = await filesystemEntrySnapshot(childPath, skipSymlinks)
      if (!childSnapshot) {
        if (skipSymlinks && (await lstatBigIntIfExists(childPath))?.isSymbolicLink()) continue
        throw new Error(`Agent migration fingerprint source disappeared: ${childPath}`)
      }
      updateFingerprintField(contentHash, entry)
      updateFingerprintField(contentHash, childSnapshot.fingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(targetPath, targetStat)
  return {
    fingerprint: contentHash.digest('hex')
  }
}

async function filesystemEntryMetadataFingerprint(targetPath: string): Promise<string | undefined> {
  const targetStat = await lstatBigIntIfExists(targetPath)
  if (!targetStat) return undefined

  const hash = initializeMetadataFingerprint(targetStat)
  if (filesystemEntryKind(targetStat) === 'directory') {
    const entries = await readdir(targetPath)
    entries.sort()
    for (const entry of entries) {
      const childFingerprint = await filesystemEntryMetadataFingerprint(path.join(targetPath, entry))
      if (!childFingerprint) {
        throw new Error(`Agent migration fingerprint source disappeared: ${path.join(targetPath, entry)}`)
      }
      updateFingerprintField(hash, entry)
      updateFingerprintField(hash, childFingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(targetPath, targetStat)
  return hash.digest('hex')
}

async function materializedCopySourceSnapshot(
  targetPath: string,
  sourceWorkspaceRoot: string,
  visitedRealPaths = new Set<string>(),
  realWorkspaceRoot?: string
): Promise<CopySourceSnapshot | undefined> {
  const targetStat = await lstatBigIntIfExists(targetPath)
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  const copiedHash = createHash('sha256')
  const metadataHash = initializeMetadataFingerprint(targetStat)

  if (kind === 'symlink') {
    let resolved: string
    try {
      resolved = await realpath(targetPath)
    } catch {
      return undefined
    }
    const workspaceRoot = realWorkspaceRoot ?? (await realpath(sourceWorkspaceRoot))
    if (!isPathInsideOrEqual(resolved, workspaceRoot) || resolved === workspaceRoot || visitedRealPaths.has(resolved)) {
      return undefined
    }
    visitedRealPaths.add(resolved)
    const resolvedSnapshot = await materializedCopySourceSnapshot(
      resolved,
      sourceWorkspaceRoot,
      visitedRealPaths,
      workspaceRoot
    )
    visitedRealPaths.delete(resolved)
    if (!resolvedSnapshot) return undefined
    updateFingerprintField(metadataHash, resolvedSnapshot.metadataFingerprint)
    await assertFilesystemEntryUnchanged(targetPath, targetStat)
    return {
      copiedFingerprint: resolvedSnapshot.copiedFingerprint,
      metadataFingerprint: metadataHash.digest('hex')
    }
  }

  updateFingerprintField(copiedHash, kind)
  if (kind === 'file') {
    for await (const chunk of createReadStream(targetPath)) {
      copiedHash.update(chunk)
    }
  } else {
    const entries = await readdir(targetPath)
    entries.sort()
    for (const entry of entries) {
      const childSnapshot = await materializedCopySourceSnapshot(
        path.join(targetPath, entry),
        sourceWorkspaceRoot,
        visitedRealPaths,
        realWorkspaceRoot
      )
      if (!childSnapshot) return undefined
      updateFingerprintField(copiedHash, entry)
      updateFingerprintField(copiedHash, childSnapshot.copiedFingerprint)
      updateFingerprintField(metadataHash, entry)
      updateFingerprintField(metadataHash, childSnapshot.metadataFingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(targetPath, targetStat)
  return {
    copiedFingerprint: copiedHash.digest('hex'),
    metadataFingerprint: metadataHash.digest('hex')
  }
}

async function materializedSourceMetadataFingerprint(
  targetPath: string,
  sourceWorkspaceRoot: string,
  visitedRealPaths = new Set<string>(),
  realWorkspaceRoot?: string
): Promise<string | undefined> {
  const targetStat = await lstatBigIntIfExists(targetPath)
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  const metadataHash = initializeMetadataFingerprint(targetStat)
  if (kind === 'symlink') {
    let resolved: string
    try {
      resolved = await realpath(targetPath)
    } catch {
      return undefined
    }
    const workspaceRoot = realWorkspaceRoot ?? (await realpath(sourceWorkspaceRoot))
    if (!isPathInsideOrEqual(resolved, workspaceRoot) || resolved === workspaceRoot || visitedRealPaths.has(resolved)) {
      return undefined
    }
    visitedRealPaths.add(resolved)
    const resolvedFingerprint = await materializedSourceMetadataFingerprint(
      resolved,
      sourceWorkspaceRoot,
      visitedRealPaths,
      workspaceRoot
    )
    visitedRealPaths.delete(resolved)
    if (!resolvedFingerprint) return undefined
    updateFingerprintField(metadataHash, resolvedFingerprint)
  } else if (kind === 'directory') {
    const entries = await readdir(targetPath)
    entries.sort()
    for (const entry of entries) {
      const childFingerprint = await materializedSourceMetadataFingerprint(
        path.join(targetPath, entry),
        sourceWorkspaceRoot,
        visitedRealPaths,
        realWorkspaceRoot
      )
      if (!childFingerprint) return undefined
      updateFingerprintField(metadataHash, entry)
      updateFingerprintField(metadataHash, childFingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(targetPath, targetStat)
  return metadataHash.digest('hex')
}

async function workspaceCopySourceSnapshot(
  sourcePath: string,
  finalDestinationPath: string,
  sourceWorkspaceRoot: string,
  destinationWorkspaceRoot: string,
  agentDataPath: string
): Promise<CopySourceSnapshot | undefined> {
  const sourceStat = await lstatBigIntIfExists(sourcePath)
  if (!sourceStat) return undefined

  const kind = filesystemEntryKind(sourceStat)
  const copiedHash = createHash('sha256')
  const metadataHash = initializeMetadataFingerprint(sourceStat)
  updateFingerprintField(copiedHash, kind)

  if (kind === 'symlink') {
    const linkTarget = await readlink(sourcePath)
    const linkType = await workspaceLinkType(sourcePath)
    updateFingerprintField(
      copiedHash,
      copiedWorkspaceLinkTarget(
        migratedLinkTarget(
          sourcePath,
          finalDestinationPath,
          linkTarget,
          sourceWorkspaceRoot,
          destinationWorkspaceRoot,
          agentDataPath
        ),
        finalDestinationPath,
        linkType
      )
    )
    await assertFilesystemEntryUnchanged(sourcePath, sourceStat)
    return {
      copiedFingerprint: copiedHash.digest('hex'),
      metadataFingerprint: metadataHash.digest('hex'),
      linkType
    }
  } else if (kind === 'file') {
    for await (const chunk of createReadStream(sourcePath)) {
      copiedHash.update(chunk)
    }
  } else {
    const entries = await readdir(sourcePath)
    entries.sort()
    for (const entry of entries) {
      const childSnapshot = await workspaceCopySourceSnapshot(
        path.join(sourcePath, entry),
        path.join(finalDestinationPath, entry),
        sourceWorkspaceRoot,
        destinationWorkspaceRoot,
        agentDataPath
      )
      if (!childSnapshot) {
        throw new Error(`Agent migration fingerprint source disappeared: ${path.join(sourcePath, entry)}`)
      }
      updateFingerprintField(copiedHash, entry)
      updateFingerprintField(copiedHash, childSnapshot.copiedFingerprint)
      updateFingerprintField(metadataHash, entry)
      updateFingerprintField(metadataHash, childSnapshot.metadataFingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(sourcePath, sourceStat)
  return {
    copiedFingerprint: copiedHash.digest('hex'),
    metadataFingerprint: metadataHash.digest('hex')
  }
}

async function requiredFilesystemEntrySnapshot(
  targetPath: string,
  skipSymlinks = false
): Promise<FilesystemEntrySnapshot> {
  const snapshot = await filesystemEntrySnapshot(targetPath, skipSymlinks)
  if (!snapshot) {
    throw new Error(`Agent migration fingerprint source disappeared: ${targetPath}`)
  }
  return snapshot
}

async function publishStagedWorkspaceEntry(
  stagingPath: string,
  destinationPath: string,
  sourceLinkType?: WorkspaceLinkType
): Promise<void> {
  const stagingStat = await lstat(stagingPath)
  if (stagingStat.isSymbolicLink()) {
    const linkType = sourceLinkType ?? (await workspaceLinkType(stagingPath))
    await createWorkspaceLink(await readlink(stagingPath), destinationPath, linkType)
    return
  }
  if (stagingStat.isFile()) {
    // A hard-link publish is atomic and fails if the target appears concurrently.
    // The staging entry is on the same managed volume and is unlinked in `finally`.
    await link(stagingPath, destinationPath)
    return
  }
  if (stagingStat.isDirectory()) {
    // The staging directory and destination share one managed volume, so rename
    // publishes the verified tree without exposing a partially copied directory.
    await rename(stagingPath, destinationPath)
    return
  }
  throw new Error(`Unsupported staged workspace entry: ${stagingPath}`)
}

async function copyWorkspaceEntry(
  sourcePath: string,
  destinationPath: string,
  sourceWorkspaceRoot: string,
  destinationWorkspaceRoot: string,
  agentDataPath: string
): Promise<void> {
  const sourceSnapshot = await workspaceCopySourceSnapshot(
    sourcePath,
    destinationPath,
    sourceWorkspaceRoot,
    destinationWorkspaceRoot,
    agentDataPath
  )
  if (!sourceSnapshot) {
    throw new Error(`Agent migration fingerprint source disappeared: ${sourcePath}`)
  }

  const stagingParent = path.dirname(destinationWorkspaceRoot)
  const stagingPrefix = `.${path.basename(destinationWorkspaceRoot)}.migration-`
  const stagingPath = path.join(stagingParent, `${stagingPrefix}${randomUUID()}`)
  try {
    await copyWorkspaceEntryPreservingLinks(
      sourcePath,
      stagingPath,
      destinationPath,
      sourceWorkspaceRoot,
      destinationWorkspaceRoot,
      agentDataPath
    )

    const currentSourceMetadata = await filesystemEntryMetadataFingerprint(sourcePath)
    if (currentSourceMetadata !== sourceSnapshot.metadataFingerprint) {
      throw new Error(`Legacy Agent workspace entry changed while being copied: ${sourcePath}`)
    }

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent workspace copy verification failed: ${sourcePath}`)
    }

    let destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
    if (destinationSnapshot) {
      if (destinationSnapshot.fingerprint === sourceSnapshot.copiedFingerprint) {
        logger.info('Reusing identical workspace entry from an earlier migration attempt', {
          sourcePath,
          destinationPath
        })
      } else {
        throw new Error(`Legacy workspace migration conflict at ${destinationPath}`)
      }
    } else {
      try {
        await publishStagedWorkspaceEntry(stagingPath, destinationPath, sourceSnapshot.linkType)
      } catch (error) {
        destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
        if (!destinationSnapshot || destinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
          throw error
        }
      }
      destinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
    }

    if (destinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent workspace entry changed while being published: ${destinationPath}`)
    }
  } finally {
    await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
  }
}

/** Materialize v1 workspace skill entries on Windows instead of linking them into the destination. */
async function copyWindowsSkillWorkspaceContent(
  agentsDataRoot: string,
  skillsDataRoot: string,
  sourceSkillsPath: string,
  destinationSkillsPath: string
): Promise<boolean> {
  if (!isWin) return false

  const sourceStat = await lstatIfExists(sourceSkillsPath)
  if (!sourceStat) return true

  const skillsDataRootStat = await lstatIfExists(skillsDataRoot)
  if (!skillsDataRootStat?.isDirectory() || skillsDataRootStat.isSymbolicLink()) {
    logger.warn(
      'Skipping Windows skills during Agent workspace migration because the skills data directory is missing or invalid',
      {
        skillsDataRoot
      }
    )
    return true
  }
  const canonicalSkillsDataRoot = await realpath(skillsDataRoot)

  let skillEntries: string[]
  if (sourceStat.isSymbolicLink()) {
    let resolvedSource: string
    try {
      resolvedSource = await realpath(sourceSkillsPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      logger.warn('Skipping missing Windows skills link during Agent workspace migration', { sourceSkillsPath })
      return true
    }
    if (path.resolve(resolvedSource) !== path.resolve(canonicalSkillsDataRoot)) {
      logger.warn('Skipping Windows skills link outside the skills data directory during Agent workspace migration', {
        sourceSkillsPath,
        resolvedSource,
        skillsDataRoot: canonicalSkillsDataRoot
      })
      return true
    }
    skillEntries = await readdir(canonicalSkillsDataRoot)
  } else if (sourceStat.isDirectory()) {
    skillEntries = await readdir(sourceSkillsPath)
  } else {
    logger.warn('Skipping invalid Windows skills entry during Agent workspace migration', { sourceSkillsPath })
    return true
  }

  await ensureAgentStorageDirectory(agentsDataRoot, destinationSkillsPath)
  for (const entry of skillEntries) {
    const sourcePath = path.join(canonicalSkillsDataRoot, entry)
    const destinationPath = path.join(destinationSkillsPath, entry)
    const entryStat = await lstatIfExists(sourcePath)
    if (!entryStat) {
      logger.warn('Skipping missing Windows skill during Agent workspace migration', { sourcePath })
      continue
    }
    if (entryStat.isSymbolicLink() || (!entryStat.isDirectory() && !entryStat.isFile())) {
      logger.warn('Skipping invalid Windows skill in the skills data directory during Agent workspace migration', {
        sourcePath
      })
      continue
    }
    if (!(await copyMaterializedEntry(sourcePath, destinationPath, canonicalSkillsDataRoot, 'skill'))) {
      logger.warn('Skipping Windows skill with a missing or unsafe linked entry during Agent workspace migration', {
        sourcePath
      })
    }
  }
  return true
}

async function copyOrdinaryWorkspaceContent(
  agentsDataRoot: string,
  skillsDataRoot: string,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string,
  agentDataPath: string
): Promise<void> {
  const sourceStat = await lstatIfExists(sourceWorkspacePath)
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) return

  await ensureAgentStorageDirectory(agentsDataRoot, destinationWorkspacePath)
  for (const entry of await readdir(sourceWorkspacePath)) {
    if (IDENTITY_ENTRY_NAMES.has(entry.toLowerCase())) continue
    if (
      entry.toLowerCase() === 'skills' &&
      (await copyWindowsSkillWorkspaceContent(
        agentsDataRoot,
        skillsDataRoot,
        path.join(sourceWorkspacePath, entry),
        path.join(destinationWorkspacePath, entry)
      ))
    ) {
      continue
    }
    const destinationPath = path.join(destinationWorkspacePath, entry)
    await copyWorkspaceEntry(
      path.join(sourceWorkspacePath, entry),
      destinationPath,
      sourceWorkspacePath,
      destinationWorkspacePath,
      agentDataPath
    )
  }
}

export async function stageLegacyAgentFiles(input: {
  agentsDataRoot: string
  skillsDataRoot: string
  agents: Array<{ sourceAgentId: string; finalAgentId: string }>
  sessions: AgentFileSessionPlan[]
}): Promise<void> {
  const plansByAgent = new Map<string, AgentFileSessionPlan[]>()
  for (const session of input.sessions) {
    const plans = plansByAgent.get(session.sourceAgentId) ?? []
    plans.push(session)
    plansByAgent.set(session.sourceAgentId, plans)
  }

  for (const { sourceAgentId, finalAgentId } of input.agents) {
    const agentPlans = plansByAgent.get(sourceAgentId) ?? []
    const agentDataPath = agentDataDirectoryPath(input.agentsDataRoot, finalAgentId)
    await ensureAgentStorageDirectory(input.agentsDataRoot, agentDataPath)
    const defaultWorkspacePath = legacyAgentWorkspacePath(input.agentsDataRoot, sourceAgentId)

    const orderedSources = [...agentPlans]
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          right.createdAt - left.createdAt ||
          left.sourceSessionId.localeCompare(right.sourceSessionId)
      )
      .map((plan) => plan.sourceWorkspacePath)
    orderedSources.push(defaultWorkspacePath)

    const seenSources = new Set<string>()
    const claimedIdentityEntries = new Set<string>()
    for (const sourcePath of orderedSources) {
      const normalizedSource = path.resolve(sourcePath)
      if (seenSources.has(normalizedSource) || normalizedSource === path.resolve(agentDataPath)) continue
      seenSources.add(normalizedSource)
      await copyIdentityFromWorkspace(sourcePath, agentDataPath, claimedIdentityEntries)
    }

    await ensureAgentDataDirectory(input.agentsDataRoot, finalAgentId)

    const systemSessions = agentPlans.filter((plan) => plan.isManagedDefault && plan.systemWorkspacePath)
    for (const session of systemSessions) {
      if (session.systemWorkspacePath) {
        await ensureAgentStorageDirectory(input.agentsDataRoot, session.systemWorkspacePath)
      }
    }

    if (path.resolve(defaultWorkspacePath) === path.resolve(agentDataPath)) continue

    for (const session of systemSessions) {
      if (!session.systemWorkspacePath) continue
      await copyOrdinaryWorkspaceContent(
        input.agentsDataRoot,
        input.skillsDataRoot,
        session.sourceWorkspacePath,
        session.systemWorkspacePath,
        agentDataPath
      )
    }
  }
}
