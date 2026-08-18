import { createHash, type Hash, randomUUID } from 'node:crypto'
import { type BigIntStats, constants, createReadStream } from 'node:fs'
import { copyFile, cp, link, lstat, mkdir, readdir, readlink, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  agentDataDirectoryPath,
  assertAgentStoragePath,
  ensureAgentDataDirectory,
  ensureAgentStorageDirectory,
  resolveRealOrNearestExistingPath
} from '@main/ai/agents/agentDataDirectory'
import { isMac, isWin } from '@main/core/platform'
import { isPathInside, isSameOrInside } from '@main/utils/file'
import PQueue from 'p-queue'
import { validate as isUuid } from 'uuid'

const logger = loggerService.withContext('AgentsFilesystemMigration')
const IDENTITY_ENTRY_NAMES = new Set(['soul.md', 'user.md', 'memory'])
const CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH = 200
const AGENT_MIGRATION_FILESYSTEM_CONCURRENCY = 16
const CLAUDE_CONFIG_PROGRESS_INTERVAL_MS = 100
const CLAUDE_CONFIG_PROGRESS_BYTE_STEP = 16 * 1024 * 1024

function createFilesystemQueue(): PQueue {
  return new PQueue({ concurrency: AGENT_MIGRATION_FILESYSTEM_CONCURRENCY })
}

function queueFilesystemOperation<T>(queue: PQueue, operation: () => Promise<T>): Promise<T> {
  return queue.add(operation, { throwOnTimeout: true })
}

async function settleFilesystemOperations(operations: Array<Promise<void>>): Promise<void> {
  const settled = await Promise.allSettled(operations)
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (rejected) throw rejected.reason
}

class FilesystemBranchScheduler {
  // The caller owns the first branch; descendants borrow the remaining slots.
  private activeBranches = 1

  tryRun<T>(operation: () => Promise<T>): Promise<T> | undefined {
    if (this.activeBranches >= AGENT_MIGRATION_FILESYSTEM_CONCURRENCY) return undefined
    this.activeBranches++
    return operation().finally(() => {
      this.activeBranches--
    })
  }
}

// Keep the current branch inline and borrow only immediately available slots.
// Long-lived workers continuously refill from the shared cursor while retaining a bounded worker set.
async function processFilesystemEntriesWithWorkers<T>(
  entries: string[],
  scheduler: FilesystemBranchScheduler,
  processEntry: (entry: string, index: number) => Promise<T>,
  recordResult?: (result: T, index: number) => void
): Promise<void> {
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= entries.length) return
      const result = await processEntry(entries[index], index)
      recordResult?.(result, index)
    }
  }

  const workers: Array<Promise<void>> = [worker()]
  while (workers.length < entries.length && workers.length < AGENT_MIGRATION_FILESYSTEM_CONCURRENCY) {
    const borrowed = scheduler.tryRun(worker)
    if (!borrowed) break
    workers.push(borrowed)
  }
  await settleFilesystemOperations(workers)
}

export interface AgentFilesystemMigrationProgress {
  phase: 'identity' | 'workspace'
  processed: number
  total: number
  fileCount: number
  byteCount: number
}

export interface AgentFilesystemMigrationResult {
  skippedTargetCount: number
}

export interface ClaudeConfigMigrationProgress {
  phase: 'scanning' | 'copying' | 'verifying'
  processed: number
  total: number
  byteCount: number
  byteTotal: number
}

export interface ClaudeSessionMigrationProgress {
  processed: number
  total: number
  fileCount: number
  byteCount: number
}

type FilesystemReadProgressCallback = (byteDelta: number, fileCompleted: boolean) => void

function createClaudeConfigProgressTracker(
  phase: ClaudeConfigMigrationProgress['phase'],
  onProgress: (progress: ClaudeConfigMigrationProgress) => void,
  initialTotal = 0,
  initialByteTotal = 0
) {
  let processed = 0
  let total = initialTotal
  let byteCount = 0
  let byteTotal = initialByteTotal
  let lastPublishedAt = performance.now()
  let lastPublishedBytes = 0
  let lastPublishedPercent = -1

  const publish = (force = false) => {
    const boundedProcessed = total > 0 ? Math.min(processed, total) : processed
    const boundedByteCount = byteTotal > 0 ? Math.min(byteCount, byteTotal) : byteCount
    const percent =
      byteTotal > 0
        ? Math.floor((boundedByteCount / byteTotal) * 100)
        : total > 0
          ? Math.floor((boundedProcessed / total) * 100)
          : -1
    const now = performance.now()
    if (
      !force &&
      percent === lastPublishedPercent &&
      now - lastPublishedAt < CLAUDE_CONFIG_PROGRESS_INTERVAL_MS &&
      boundedByteCount - lastPublishedBytes < CLAUDE_CONFIG_PROGRESS_BYTE_STEP
    ) {
      return
    }

    lastPublishedAt = now
    lastPublishedBytes = boundedByteCount
    lastPublishedPercent = percent
    onProgress({
      phase,
      processed: boundedProcessed,
      total,
      byteCount: boundedByteCount,
      byteTotal
    })
  }

  publish(true)
  return {
    recordRead(byteDelta: number, fileCompleted: boolean) {
      byteCount += byteDelta
      if (fileCompleted) processed++
      publish()
    },
    recordFile(fileBytes: number) {
      processed++
      byteCount += fileBytes
      publish()
    },
    finish(finalTotal: number, finalByteTotal: number) {
      processed = finalTotal
      total = finalTotal
      byteCount = finalByteTotal
      byteTotal = finalByteTotal
      publish(true)
    }
  }
}

interface CopyEntryResult {
  copied: boolean
  skipped?: boolean
  fileCount: number
  byteCount: number
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

async function realpathIfExists(targetPath: string): Promise<string | undefined> {
  try {
    return await realpath(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function isUnknownRealpathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'UNKNOWN' &&
    'syscall' in error &&
    error.syscall === 'realpath'
  )
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

/**
 * Order managed-default sessions by recency so the shared v1 workspace content is
 * materialized into the session most likely to be resumed. Ties fall back to the
 * lexicographically smaller session id, matching the identity-source ordering.
 */
function isLaterManagedSession(candidate: AgentFileSessionPlan, incumbent: AgentFileSessionPlan): boolean {
  if (candidate.updatedAt !== incumbent.updatedAt) return candidate.updatedAt > incumbent.updatedAt
  if (candidate.createdAt !== incumbent.createdAt) return candidate.createdAt > incumbent.createdAt
  return candidate.sourceSessionId.localeCompare(incumbent.sourceSessionId) < 0
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

async function materializeIdentityEntry(sourcePath: string, destinationPath: string): Promise<boolean> {
  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink()) {
    logger.warn('Skipping identity symlink during Agent migration', { sourcePath })
    return false
  }

  if (sourceStat.isDirectory()) {
    await mkdir(destinationPath)

    for (const entry of await readdir(sourcePath)) {
      await materializeIdentityEntry(path.join(sourcePath, entry), path.join(destinationPath, entry))
    }
    return true
  }

  if (!sourceStat.isFile()) {
    logger.warn('Skipping unsupported identity filesystem entry', { sourcePath })
    return false
  }

  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
  return true
}

async function copyIdentityEntry(sourcePath: string, destinationPath: string): Promise<CopyEntryResult | undefined> {
  const sourceSnapshot = await identityCopySourceSnapshot(sourcePath)
  if (!sourceSnapshot) return undefined

  const existingDestination = await filesystemEntrySnapshot(destinationPath)
  if (existingDestination) {
    if (existingDestination.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent identity destination conflict: ${destinationPath}`)
    }
    logger.info('Reusing identical identity entry created after migration target cleanup', {
      sourcePath,
      destinationPath
    })
    return {
      copied: false,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount
    }
  }

  const stagingPrefix = `.${path.basename(destinationPath)}.migration-`
  const stagingPath = path.join(path.dirname(destinationPath), `${stagingPrefix}${randomUUID()}`)

  try {
    if (!(await materializeIdentityEntry(sourcePath, stagingPath))) {
      throw new Error(`Legacy Agent identity changed while being copied: ${sourcePath}`)
    }

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent identity copy verification failed: ${sourcePath}`)
    }

    const racedDestinationStat = await lstatIfExists(destinationPath)
    if (racedDestinationStat) {
      const racedDestinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
      if (racedDestinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
        throw new Error(`Legacy Agent identity destination conflict: ${destinationPath}`)
      }
      logger.info('Reusing identical identity entry from an earlier migration attempt', {
        sourcePath,
        destinationPath
      })
      return {
        copied: false,
        fileCount: sourceSnapshot.fileCount,
        byteCount: sourceSnapshot.byteCount
      }
    } else {
      try {
        await publishStagedWorkspaceEntry(stagingPath, destinationPath)
      } catch (error) {
        const racedDestinationSnapshot = await filesystemEntrySnapshot(destinationPath)
        if (!racedDestinationSnapshot || racedDestinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
          throw error
        }
        return {
          copied: false,
          fileCount: sourceSnapshot.fileCount,
          byteCount: sourceSnapshot.byteCount
        }
      }
    }

    return {
      copied: true,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount
    }
  } finally {
    await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
  }
}

async function copyIdentityFromWorkspace(
  sourceWorkspacePath: string,
  agentDataPath: string,
  claimedIdentityEntries: Set<string>
): Promise<{ fileCount: number; byteCount: number }> {
  const sourceStat = await lstatIfExists(sourceWorkspacePath)
  if (!sourceStat) return { fileCount: 0, byteCount: 0 }

  if (sourceStat.isSymbolicLink()) {
    logger.warn('Skipping symlinked legacy workspace root during Agent migration', { sourceWorkspacePath })
    return { fileCount: 0, byteCount: 0 }
  } else if (!sourceStat.isDirectory()) {
    return { fileCount: 0, byteCount: 0 }
  }

  let fileCount = 0
  let byteCount = 0
  for (const name of ['SOUL.md', 'USER.md', 'memory']) {
    if (claimedIdentityEntries.has(name)) continue
    const sourcePath = await findCaseInsensitiveEntry(sourceWorkspacePath, name)
    if (!sourcePath) continue
    const destinationPath = path.join(agentDataPath, name)
    const result = await copyIdentityEntry(sourcePath, destinationPath)
    if (result) {
      claimedIdentityEntries.add(name)
      fileCount += result.fileCount
      byteCount += result.byteCount
    }
  }
  return { fileCount, byteCount }
}

async function removeTreeWithoutFollowing(targetPath: string): Promise<void> {
  await removeTreeWithoutFollowingWithQueue(targetPath, createFilesystemQueue(), new FilesystemBranchScheduler())
}

async function removeTreeWithoutFollowingWithQueue(
  targetPath: string,
  queue: PQueue,
  scheduler: FilesystemBranchScheduler
): Promise<void> {
  const targetStat = await queueFilesystemOperation(queue, () => lstatIfExists(targetPath))
  if (!targetStat) return
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    await queueFilesystemOperation(queue, () => unlink(targetPath))
    return
  }
  const entries = await queueFilesystemOperation(queue, () => readdir(targetPath))
  await processFilesystemEntriesWithWorkers(entries, scheduler, (entry) =>
    removeTreeWithoutFollowingWithQueue(path.join(targetPath, entry), queue, scheduler)
  )
  await queueFilesystemOperation(queue, () => rmdir(targetPath))
}

/**
 * Copy the v1 global Claude Agent SDK config into its v2 Agent-data location.
 * The source remains intact for downgrade compatibility. Publication is
 * atomic, an existing destination directory is left untouched, and symlinks
 * are skipped so the copy does not require Windows symlink privileges.
 */
export async function copyLegacyClaudeConfig(
  sourcePath: string,
  destinationPath: string,
  onProgress?: (progress: ClaudeConfigMigrationProgress) => void
): Promise<boolean> {
  const startedAt = performance.now()
  const destinationStat = await lstatIfExists(destinationPath)
  if (destinationStat?.isDirectory() && !destinationStat.isSymbolicLink()) {
    logger.info('Skipping legacy Claude config migration because the destination directory already exists', {
      sourcePath,
      destinationPath,
      durationMs: Math.round(performance.now() - startedAt)
    })
    return false
  }

  const sourceStat = await lstatIfExists(sourcePath)
  if (!sourceStat) return false
  if (sourceStat.isSymbolicLink()) {
    logger.warn('Skipping symlinked legacy Claude config root during Agent migration', { sourcePath })
    return false
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`Legacy Claude config source is not a directory: ${sourcePath}`)
  }

  const sourceStats = onProgress ? await filesystemEntryStats(sourcePath) : undefined
  if (onProgress && !sourceStats) throw new Error(`Legacy Claude config source disappeared: ${sourcePath}`)
  const scanningProgress =
    onProgress && sourceStats
      ? createClaudeConfigProgressTracker('scanning', onProgress, sourceStats.fileCount, sourceStats.byteCount)
      : undefined
  const sourceSnapshot = await requiredFilesystemEntrySnapshot(sourcePath, true, scanningProgress?.recordRead)
  scanningProgress?.finish(sourceSnapshot.fileCount, sourceSnapshot.byteCount)

  await mkdir(path.dirname(destinationPath), { recursive: true })
  const stagingPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.migration-${randomUUID()}`
  )

  try {
    const copyingProgress = onProgress
      ? createClaudeConfigProgressTracker('copying', onProgress, sourceSnapshot.fileCount, sourceSnapshot.byteCount)
      : undefined
    await cp(sourcePath, stagingPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
      filter: async (entryPath) => {
        const entryStat = await lstat(entryPath)
        if (!entryStat.isSymbolicLink()) {
          // fs.cp invokes the filter immediately before copying each entry, so
          // this is file-granularity progress and leads by at most one file.
          if (entryStat.isFile()) copyingProgress?.recordFile(entryStat.size)
          return true
        }
        logger.warn('Skipping symlink while copying legacy Claude config', { entryPath })
        return false
      }
    })
    copyingProgress?.finish(sourceSnapshot.fileCount, sourceSnapshot.byteCount)

    const verifyingProgress = onProgress
      ? createClaudeConfigProgressTracker('verifying', onProgress, sourceSnapshot.fileCount, sourceSnapshot.byteCount)
      : undefined
    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath, false, verifyingProgress?.recordRead)
    verifyingProgress?.finish(stagingSnapshot.fileCount, stagingSnapshot.byteCount)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
      throw new Error(`Legacy Claude config copy verification failed: ${sourcePath}`)
    }

    const racedDestinationStat = await lstatIfExists(destinationPath)
    if (racedDestinationStat) {
      const racedDestinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
      if (racedDestinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
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
        const racedDestinationSnapshot = await filesystemEntrySnapshot(destinationPath)
        if (!racedDestinationSnapshot || racedDestinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
          throw error
        }
      }
    }

    logger.info('Copied legacy Claude config into the v2 Agents data directory', {
      sourcePath,
      destinationPath,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount,
      durationMs: Math.round(performance.now() - startedAt)
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

async function copyClaudeSessionEntry(
  sourcePath: string,
  destinationPath: string,
  sourceSnapshots: Map<string, FilesystemEntrySnapshot>
): Promise<CopyEntryResult> {
  const sourceStat = await lstatIfExists(sourcePath)
  if (!sourceStat) {
    throw new Error(`Legacy Claude session cache disappeared: ${sourcePath}`)
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Legacy Claude session cache is not a regular file: ${sourcePath}`)
  }

  const sourceKey = path.resolve(sourcePath)
  let sourceSnapshot = sourceSnapshots.get(sourceKey)
  if (!sourceSnapshot) {
    sourceSnapshot = await requiredFilesystemEntrySnapshot(sourcePath, true)
    sourceSnapshots.set(sourceKey, sourceSnapshot)
  }
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return {
      copied: false,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount
    }
  }

  await removeTreeWithoutFollowing(destinationPath)
  const cleanedDestinationRace = await filesystemEntrySnapshot(destinationPath)
  if (cleanedDestinationRace) {
    if (cleanedDestinationRace.fingerprint !== sourceSnapshot.fingerprint) {
      throw new Error(`Legacy Claude session cache destination conflict: ${destinationPath}`)
    }
    logger.info('Reusing identical Claude session cache entry created after target cleanup', {
      sourcePath,
      destinationPath
    })
    return {
      copied: false,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount
    }
  }

  const stagingPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.migration-${randomUUID()}`
  )
  try {
    await copyFile(sourcePath, stagingPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
      throw new Error(`Legacy Claude session cache copy verification failed: ${sourcePath}`)
    }

    const racedDestinationStat = await lstatIfExists(destinationPath)
    if (racedDestinationStat) {
      const racedDestinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
      if (racedDestinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
        throw new Error(`Legacy Claude session cache destination conflict: ${destinationPath}`)
      }
      logger.info('Reusing identical Claude session cache entry from an earlier migration attempt', {
        sourcePath,
        destinationPath
      })
      return {
        copied: false,
        fileCount: sourceSnapshot.fileCount,
        byteCount: sourceSnapshot.byteCount
      }
    } else {
      try {
        await publishStagedWorkspaceEntry(stagingPath, destinationPath)
      } catch (error) {
        const racedDestinationSnapshot = await filesystemEntrySnapshot(destinationPath)
        if (!racedDestinationSnapshot || racedDestinationSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
          throw error
        }
        return {
          copied: false,
          fileCount: sourceSnapshot.fileCount,
          byteCount: sourceSnapshot.byteCount
        }
      }
    }

    return {
      copied: true,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount
    }
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
  onProgress?: (progress: ClaudeSessionMigrationProgress) => void
}): Promise<void> {
  const startedAt = performance.now()
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
  const sourceSnapshots = new Map<string, FilesystemEntrySnapshot>()
  let preparedEntries = 0
  let reusedEntries = 0
  let fileCount = 0
  let byteCount = 0
  const eligibleCopyPlanIndices = copyPlans
    .map((copyPlan, index) => ({ copyPlan, index }))
    .filter(
      ({ copyPlan, index }) => resumableSessionIds.has(copyPlan.sourceSessionId) && resolvedSourcesByCopyPlan[index]
    )

  for (const [eligibleIndex, { copyPlan, index: copyPlanIndex }] of eligibleCopyPlanIndices.entries()) {
    const source = resolvedSourcesByCopyPlan[copyPlanIndex]!

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

    const result = await copyClaudeSessionEntry(
      source.transcriptPath,
      path.join(destinationProjectDirectory, `${copyPlan.runtimeResumeToken}.jsonl`),
      sourceSnapshots
    )
    if (result.copied) {
      preparedEntries++
    } else {
      reusedEntries++
    }
    fileCount += result.fileCount
    byteCount += result.byteCount
    input.onProgress?.({
      processed: eligibleIndex + 1,
      total: eligibleCopyPlanIndices.length,
      fileCount,
      byteCount
    })
  }

  logger.info('Prepared Claude session cache for migrated Agent workspace paths', {
    requestedSessions: copyPlans.length,
    preparedEntries,
    reusedEntries,
    uniqueSources: sourceSnapshots.size,
    fileCount,
    byteCount,
    durationMs: Math.round(performance.now() - startedAt)
  })
}

type FilesystemEntryKind = 'directory' | 'file' | 'symlink'

interface FilesystemEntrySnapshot {
  fingerprint: string
  fileCount: number
  byteCount: number
}

type FilesystemEntryStats = Omit<FilesystemEntrySnapshot, 'fingerprint'>

interface CopySourceSnapshot {
  copiedFingerprint: string
  fileCount: number
  byteCount: number
}

interface WorkspaceSourceSnapshot {
  kind: Exclude<FilesystemEntryKind, 'symlink'>
  copiedFingerprint: string
  fileCount: number
  byteCount: number
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

async function filesystemEntrySnapshot(
  targetPath: string,
  skipSymlinks = false,
  onReadProgress?: FilesystemReadProgressCallback
): Promise<FilesystemEntrySnapshot | undefined> {
  return filesystemEntrySnapshotWithQueue(
    targetPath,
    skipSymlinks,
    createFilesystemQueue(),
    new FilesystemBranchScheduler(),
    onReadProgress
  )
}

async function filesystemEntrySnapshotWithQueue(
  targetPath: string,
  skipSymlinks: boolean,
  queue: PQueue,
  scheduler: FilesystemBranchScheduler,
  onReadProgress?: FilesystemReadProgressCallback
): Promise<FilesystemEntrySnapshot | undefined> {
  const targetStat = await queueFilesystemOperation(queue, () => lstatBigIntIfExists(targetPath))
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  if (skipSymlinks && kind === 'symlink') return undefined

  const contentHash = createHash('sha256')
  updateFingerprintField(contentHash, kind)
  let fileCount = 0
  let byteCount = 0

  if (kind === 'symlink') {
    updateFingerprintField(contentHash, await queueFilesystemOperation(queue, () => readlink(targetPath)))
  } else if (kind === 'file') {
    fileCount = 1
    byteCount = Number(targetStat.size)
    await queueFilesystemOperation(queue, async () => {
      for await (const chunk of createReadStream(targetPath)) {
        contentHash.update(chunk)
        onReadProgress?.(chunk.length, false)
      }
    })
  } else {
    const entries = await queueFilesystemOperation(queue, () => readdir(targetPath))
    entries.sort()
    const children: Array<{ entry: string; snapshot: FilesystemEntrySnapshot } | undefined> = new Array(entries.length)
    await processFilesystemEntriesWithWorkers(
      entries,
      scheduler,
      async (entry) => {
        const childPath = path.join(targetPath, entry)
        const childSnapshot = await filesystemEntrySnapshotWithQueue(
          childPath,
          skipSymlinks,
          queue,
          scheduler,
          onReadProgress
        )
        if (!childSnapshot) {
          if (
            skipSymlinks &&
            (await queueFilesystemOperation(queue, () => lstatBigIntIfExists(childPath)))?.isSymbolicLink()
          ) {
            return undefined
          }
          throw new Error(`Agent migration fingerprint source disappeared: ${childPath}`)
        }
        return { entry, snapshot: childSnapshot }
      },
      (child, index) => {
        children[index] = child
      }
    )
    for (const child of children) {
      if (!child) continue
      const { entry, snapshot } = child
      updateFingerprintField(contentHash, entry)
      updateFingerprintField(contentHash, snapshot.fingerprint)
      fileCount += snapshot.fileCount
      byteCount += snapshot.byteCount
    }
  }

  if (kind === 'file') onReadProgress?.(0, true)
  return {
    fingerprint: contentHash.digest('hex'),
    fileCount,
    byteCount
  }
}

async function filesystemEntryStats(targetPath: string): Promise<FilesystemEntryStats | undefined> {
  return filesystemEntryStatsWithQueue(targetPath, createFilesystemQueue(), new FilesystemBranchScheduler())
}

async function filesystemEntryStatsWithQueue(
  targetPath: string,
  queue: PQueue,
  scheduler: FilesystemBranchScheduler
): Promise<FilesystemEntryStats | undefined> {
  const targetStat = await queueFilesystemOperation(queue, () => lstatBigIntIfExists(targetPath))
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  let fileCount = kind === 'file' ? 1 : 0
  let byteCount = kind === 'file' ? Number(targetStat.size) : 0
  if (kind === 'directory') {
    const entries = await queueFilesystemOperation(queue, () => readdir(targetPath))
    entries.sort()
    const childStats: FilesystemEntryStats[] = new Array(entries.length)
    await processFilesystemEntriesWithWorkers(
      entries,
      scheduler,
      async (entry) => {
        const childPath = path.join(targetPath, entry)
        const stats = await filesystemEntryStatsWithQueue(childPath, queue, scheduler)
        if (!stats) {
          throw new Error(`Agent migration fingerprint source disappeared: ${childPath}`)
        }
        return stats
      },
      (stats, index) => {
        childStats[index] = stats
      }
    )
    for (const stats of childStats) {
      fileCount += stats.fileCount
      byteCount += stats.byteCount
    }
  }

  return { fileCount, byteCount }
}

async function identityCopySourceSnapshot(targetPath: string): Promise<CopySourceSnapshot | undefined> {
  const targetStat = await lstatBigIntIfExists(targetPath)
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  const copiedHash = createHash('sha256')

  if (kind === 'symlink') {
    logger.warn('Skipping identity symlink while snapshotting Agent migration source', { targetPath })
    return undefined
  }

  updateFingerprintField(copiedHash, kind)
  let fileCount = 0
  let byteCount = 0
  if (kind === 'file') {
    fileCount = 1
    byteCount = Number(targetStat.size)
    for await (const chunk of createReadStream(targetPath)) {
      copiedHash.update(chunk)
    }
  } else {
    const entries = await readdir(targetPath)
    entries.sort()
    for (const entry of entries) {
      const childPath = path.join(targetPath, entry)
      const childSnapshot = await identityCopySourceSnapshot(childPath)
      if (!childSnapshot) {
        const childStat = await lstatBigIntIfExists(childPath)
        if (childStat?.isSymbolicLink()) continue
        throw new Error(`Legacy Agent identity source changed while being scanned: ${childPath}`)
      }
      updateFingerprintField(copiedHash, entry)
      updateFingerprintField(copiedHash, childSnapshot.copiedFingerprint)
      fileCount += childSnapshot.fileCount
      byteCount += childSnapshot.byteCount
    }
  }

  return {
    copiedFingerprint: copiedHash.digest('hex'),
    fileCount,
    byteCount
  }
}

async function workspaceSourceSnapshot(sourcePath: string): Promise<WorkspaceSourceSnapshot | undefined> {
  return workspaceSourceSnapshotWithQueue(sourcePath, createFilesystemQueue(), new FilesystemBranchScheduler())
}

async function workspaceSourceSnapshotWithQueue(
  sourcePath: string,
  queue: PQueue,
  scheduler: FilesystemBranchScheduler
): Promise<WorkspaceSourceSnapshot | undefined> {
  const sourceStat = await queueFilesystemOperation(queue, () => lstatBigIntIfExists(sourcePath))
  if (!sourceStat) return undefined

  const kind = filesystemEntryKind(sourceStat)
  if (kind === 'symlink') {
    logger.warn('Skipping workspace symlink while snapshotting Agent migration source', { sourcePath })
    return undefined
  }

  const copiedHash = createHash('sha256')
  updateFingerprintField(copiedHash, kind)
  if (kind === 'file') {
    await queueFilesystemOperation(queue, async () => {
      for await (const chunk of createReadStream(sourcePath)) {
        copiedHash.update(chunk)
      }
    })
    const copiedFingerprint = copiedHash.digest('hex')
    return {
      kind,
      copiedFingerprint,
      fileCount: 1,
      byteCount: Number(sourceStat.size)
    }
  }

  let fileCount = 0
  let byteCount = 0
  const entries = await queueFilesystemOperation(queue, () => readdir(sourcePath))
  entries.sort()
  const childSnapshots: Array<{ name: string; snapshot: WorkspaceSourceSnapshot } | undefined> = new Array(
    entries.length
  )
  await processFilesystemEntriesWithWorkers(
    entries,
    scheduler,
    async (entry) => {
      const childPath = path.join(sourcePath, entry)
      const snapshot = await workspaceSourceSnapshotWithQueue(childPath, queue, scheduler)
      if (!snapshot) {
        const childStat = await queueFilesystemOperation(queue, () => lstatBigIntIfExists(childPath))
        if (childStat?.isSymbolicLink()) return undefined
        throw new Error(`Agent migration fingerprint source disappeared: ${childPath}`)
      }
      return { name: entry, snapshot }
    },
    (child, index) => {
      childSnapshots[index] = child
    }
  )
  for (const child of childSnapshots) {
    if (!child) continue
    const { name: entry, snapshot: childSnapshot } = child
    updateFingerprintField(copiedHash, entry)
    updateFingerprintField(copiedHash, childSnapshot.copiedFingerprint)
    fileCount += childSnapshot.fileCount
    byteCount += childSnapshot.byteCount
  }

  return {
    kind,
    copiedFingerprint: copiedHash.digest('hex'),
    fileCount,
    byteCount
  }
}

async function requiredFilesystemEntrySnapshot(
  targetPath: string,
  skipSymlinks = false,
  onReadProgress?: FilesystemReadProgressCallback
): Promise<FilesystemEntrySnapshot> {
  const snapshot = await filesystemEntrySnapshot(targetPath, skipSymlinks, onReadProgress)
  if (!snapshot) {
    throw new Error(`Agent migration fingerprint source disappeared: ${targetPath}`)
  }
  return snapshot
}

async function publishStagedWorkspaceEntry(stagingPath: string, destinationPath: string): Promise<void> {
  const stagingStat = await lstat(stagingPath)
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

interface WorkspaceCopyContext {
  sourceSnapshots: Map<string, WorkspaceSourceSnapshot>
  reusableStagingPaths: Map<string, string>
  pendingPublications: PendingWorkspacePublication[]
}

interface PendingWorkspacePublication {
  sourcePath: string
  stagingPath: string
  destinationPath: string
  copiedFingerprint: string
}

async function sourceSnapshotForWorkspaceEntry(
  context: WorkspaceCopyContext,
  sourcePath: string
): Promise<WorkspaceSourceSnapshot | undefined> {
  const sourceKey = path.resolve(sourcePath)
  const cachedSnapshot = context.sourceSnapshots.get(sourceKey)
  if (cachedSnapshot) return cachedSnapshot

  const sourceSnapshot = await workspaceSourceSnapshot(sourcePath)
  if (!sourceSnapshot) return undefined
  context.sourceSnapshots.set(sourceKey, sourceSnapshot)
  return sourceSnapshot
}

/**
 * Clone regular content without following or recreating symlinks.
 * COPYFILE_FICLONE uses copy-on-write where the volume supports it and
 * otherwise performs a regular kernel copy. The first private staging entry
 * becomes the reusable source for later Sessions, so migration never needs an
 * additional full-size template. Symlinks are discarded before the complete
 * private staging tree is fingerprinted.
 */
async function cloneWorkspaceRegularContent(sourcePath: string, destinationPath: string): Promise<void> {
  await cloneWorkspaceRegularContentWithQueue(
    sourcePath,
    destinationPath,
    createFilesystemQueue(),
    new FilesystemBranchScheduler()
  )
}

async function cloneWorkspaceRegularContentWithQueue(
  sourcePath: string,
  destinationPath: string,
  queue: PQueue,
  scheduler: FilesystemBranchScheduler
): Promise<void> {
  const sourceStat = await queueFilesystemOperation(queue, () => lstatBigIntIfExists(sourcePath))
  if (!sourceStat) {
    throw new Error(`Agent migration reusable staging entry disappeared: ${sourcePath}`)
  }

  const kind = filesystemEntryKind(sourceStat)
  if (kind === 'symlink') {
    logger.warn('Skipping workspace symlink while copying Agent migration source', { sourcePath })
    return
  }
  if (kind === 'file') {
    await queueFilesystemOperation(queue, () =>
      copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
    )
    return
  } else {
    await queueFilesystemOperation(queue, () => mkdir(destinationPath, { mode: Number(sourceStat.mode & 0o777n) }))
    const entries = await queueFilesystemOperation(queue, () => readdir(sourcePath))
    entries.sort()
    await processFilesystemEntriesWithWorkers(entries, scheduler, (entry) =>
      cloneWorkspaceRegularContentWithQueue(
        path.join(sourcePath, entry),
        path.join(destinationPath, entry),
        queue,
        scheduler
      )
    )
  }
}

async function copyWorkspaceEntry(
  context: WorkspaceCopyContext,
  sourcePath: string,
  destinationPath: string,
  destinationWorkspaceRoot: string
): Promise<CopyEntryResult> {
  const sourceTree = await sourceSnapshotForWorkspaceEntry(context, sourcePath)
  if (!sourceTree) return { copied: false, skipped: true, fileCount: 0, byteCount: 0 }
  const sourceSnapshot = sourceTree

  const existingDestination = await filesystemEntrySnapshot(destinationPath)
  if (existingDestination) {
    if (existingDestination.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy workspace migration conflict at ${destinationPath}`)
    }
    logger.info('Reusing identical workspace entry from an earlier migration attempt', {
      sourcePath,
      destinationPath
    })
    return {
      copied: false,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount
    }
  }

  const stagingParent = path.dirname(destinationWorkspaceRoot)
  const stagingPrefix = `.${path.basename(destinationWorkspaceRoot)}.migration-`
  const stagingPath = path.join(stagingParent, `${stagingPrefix}${randomUUID()}`)
  let pendingPublication = false
  try {
    const sourceKey = path.resolve(sourcePath)
    const reusableStagingPath = context.reusableStagingPaths.get(sourceKey)
    await cloneWorkspaceRegularContent(reusableStagingPath ?? sourcePath, stagingPath)

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent workspace copy verification failed: ${sourcePath}`)
    }
    if (!reusableStagingPath) {
      context.reusableStagingPaths.set(sourceKey, stagingPath)
    }

    // Keep every verified copy private until all staging copies are prepared,
    // so a failed attempt cannot poison the next retry.
    context.pendingPublications.push({
      sourcePath,
      stagingPath,
      destinationPath,
      copiedFingerprint: sourceSnapshot.copiedFingerprint
    })
    pendingPublication = true
    return {
      copied: true,
      fileCount: sourceSnapshot.fileCount,
      byteCount: sourceSnapshot.byteCount
    }
  } finally {
    if (!pendingPublication) {
      await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
    }
  }
}

async function copyOrdinaryWorkspaceContent(
  context: WorkspaceCopyContext,
  agentsDataRoot: string,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string
): Promise<{ copiedEntries: number; reusedEntries: number; fileCount: number; byteCount: number }> {
  const sourceStat = await lstatIfExists(sourceWorkspacePath)
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
    return { copiedEntries: 0, reusedEntries: 0, fileCount: 0, byteCount: 0 }
  }

  await ensureAgentStorageDirectory(agentsDataRoot, destinationWorkspacePath)
  let copiedEntries = 0
  let reusedEntries = 0
  let fileCount = 0
  let byteCount = 0
  const entries = await readdir(sourceWorkspacePath)
  entries.sort()
  for (const entry of entries) {
    if (IDENTITY_ENTRY_NAMES.has(entry.toLowerCase())) continue
    const destinationPath = path.join(destinationWorkspacePath, entry)
    const result = await copyWorkspaceEntry(
      context,
      path.join(sourceWorkspacePath, entry),
      destinationPath,
      destinationWorkspacePath
    )
    if (result.skipped) continue
    if (result.copied) copiedEntries++
    else reusedEntries++
    fileCount += result.fileCount
    byteCount += result.byteCount
  }
  return { copiedEntries, reusedEntries, fileCount, byteCount }
}

async function publishPreparedWorkspaceEntries(
  context: WorkspaceCopyContext
): Promise<{ publishedEntries: number; reusedEntries: number }> {
  let publishedEntries = 0
  let reusedEntries = 0

  for (const publication of context.pendingPublications) {
    const existingDestination = await filesystemEntrySnapshot(publication.destinationPath)
    if (existingDestination) {
      if (existingDestination.fingerprint !== publication.copiedFingerprint) {
        throw new Error(`Legacy workspace migration conflict at ${publication.destinationPath}`)
      }
      logger.info('Reusing identical workspace entry created concurrently', {
        sourcePath: publication.sourcePath,
        destinationPath: publication.destinationPath
      })
      reusedEntries++
      continue
    }

    try {
      await publishStagedWorkspaceEntry(publication.stagingPath, publication.destinationPath)
      publishedEntries++
    } catch (error) {
      const racedDestinationSnapshot = await filesystemEntrySnapshot(publication.destinationPath)
      if (!racedDestinationSnapshot || racedDestinationSnapshot.fingerprint !== publication.copiedFingerprint) {
        throw error
      }
      logger.info('Reusing identical workspace entry created concurrently', {
        sourcePath: publication.sourcePath,
        destinationPath: publication.destinationPath
      })
      reusedEntries++
    }
  }

  return { publishedEntries, reusedEntries }
}

interface CleanupPathIndexEntry {
  indexedPath: string
  ownerPath: string
}

interface CleanupSourceOwner {
  sourceAgentId: string
  finalAgentId: string
}

interface CleanupTargetSourceOverlap {
  targetPath: string
  sourcePath: string
}

type CleanupPathAncestorIndex = Map<string, CleanupPathIndexEntry>

// Ancestor walks keep overlap validation linear in path count and bounded by path depth.
function cleanupPathIndexKey(targetPath: string): string {
  const resolvedPath = path.resolve(targetPath)
  return isMac || isWin ? resolvedPath.toLowerCase() : resolvedPath
}

function createCleanupPathAncestorIndex(entries: CleanupPathIndexEntry[]): CleanupPathAncestorIndex {
  const index: CleanupPathAncestorIndex = new Map()
  for (const entry of entries) {
    const key = cleanupPathIndexKey(entry.indexedPath)
    if (!index.has(key)) index.set(key, entry)
  }
  return index
}

function findCleanupPathAncestor(
  index: CleanupPathAncestorIndex,
  targetPath: string,
  includeSelf = true
): CleanupPathIndexEntry | undefined {
  let currentPath = cleanupPathIndexKey(targetPath)
  if (!includeSelf) {
    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) return undefined
    currentPath = parentPath
  }

  while (true) {
    const ancestor = index.get(currentPath)
    if (ancestor) return ancestor
    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) return undefined
    currentPath = parentPath
  }
}

function createCleanupTargetAncestorIndex(targets: CleanupPathIndexEntry[]): CleanupPathAncestorIndex {
  const index: CleanupPathAncestorIndex = new Map()
  for (const target of targets) {
    const key = cleanupPathIndexKey(target.indexedPath)
    const duplicate = index.get(key)
    if (duplicate) {
      throw new Error(`Legacy Agent migration cleanup targets overlap: ${duplicate.ownerPath} and ${target.ownerPath}`)
    }
    index.set(key, target)
  }

  for (const target of targets) {
    const ancestor = findCleanupPathAncestor(index, target.indexedPath, false)
    if (ancestor) {
      throw new Error(`Legacy Agent migration cleanup targets overlap: ${ancestor.ownerPath} and ${target.ownerPath}`)
    }
  }
  return index
}

function findCleanupTargetSourceOverlaps(
  targets: CleanupPathIndexEntry[],
  targetIndex: CleanupPathAncestorIndex,
  sources: CleanupPathIndexEntry[]
): CleanupTargetSourceOverlap[] {
  const overlaps = new Map<string, CleanupTargetSourceOverlap>()
  const sourceIndex = createCleanupPathAncestorIndex(sources)
  for (const source of sources) {
    const targetAncestor = findCleanupPathAncestor(targetIndex, source.indexedPath)
    if (targetAncestor) {
      overlaps.set(cleanupPathIndexKey(targetAncestor.ownerPath), {
        targetPath: targetAncestor.ownerPath,
        sourcePath: source.ownerPath
      })
    }
  }
  for (const target of targets) {
    const sourceAncestor = findCleanupPathAncestor(sourceIndex, target.indexedPath)
    if (sourceAncestor) {
      overlaps.set(cleanupPathIndexKey(target.ownerPath), {
        targetPath: target.ownerPath,
        sourcePath: sourceAncestor.ownerPath
      })
    }
  }
  return Array.from(overlaps.values())
}

async function clearLegacyAgentMigrationTargets(input: {
  agentsDataRoot: string
  agents: Array<{ sourceAgentId: string; finalAgentId: string }>
  sessions: AgentFileSessionPlan[]
}): Promise<Set<string>> {
  await ensureAgentStorageDirectory(input.agentsDataRoot, input.agentsDataRoot)

  const sourceOwnershipByPath = new Map<string, CleanupSourceOwner[]>()
  const targetKeysBySourcePath = new Map<string, Set<string>>()
  const addSourceOwner = (sourcePath: string, sourceAgentId: string, finalAgentId: string) => {
    const key = cleanupPathIndexKey(sourcePath)
    const owners = sourceOwnershipByPath.get(key) ?? []
    if (!owners.some((owner) => owner.sourceAgentId === sourceAgentId && owner.finalAgentId === finalAgentId)) {
      owners.push({ sourceAgentId, finalAgentId })
      sourceOwnershipByPath.set(key, owners)
    }
  }
  const addSourceTarget = (sourcePath: string, targetPath: string) => {
    const sourceKey = cleanupPathIndexKey(sourcePath)
    const targetKeys = targetKeysBySourcePath.get(sourceKey) ?? new Set<string>()
    targetKeys.add(cleanupPathIndexKey(path.resolve(targetPath)))
    targetKeysBySourcePath.set(sourceKey, targetKeys)
  }
  for (const session of input.sessions) {
    addSourceOwner(session.sourceWorkspacePath, session.sourceAgentId, session.finalAgentId)
    addSourceTarget(session.sourceWorkspacePath, agentDataDirectoryPath(input.agentsDataRoot, session.finalAgentId))
    if (session.isManagedDefault && session.systemWorkspacePath) {
      addSourceTarget(session.sourceWorkspacePath, session.systemWorkspacePath)
    }
  }
  for (const agent of input.agents) {
    const sourcePath = legacyAgentWorkspacePath(input.agentsDataRoot, agent.sourceAgentId)
    addSourceOwner(sourcePath, agent.sourceAgentId, agent.finalAgentId)
    addSourceTarget(sourcePath, agentDataDirectoryPath(input.agentsDataRoot, agent.finalAgentId))
  }

  const targetPaths = new Map<string, { path: string; exists: boolean; preserveExactSource: boolean }>()
  for (const { sourceAgentId, finalAgentId } of input.agents) {
    const targetPath = path.resolve(agentDataDirectoryPath(input.agentsDataRoot, finalAgentId))
    const exactSourceOwners = sourceOwnershipByPath.get(cleanupPathIndexKey(targetPath))
    // Some v1 Agents already use the final v2 Agent data path as their workspace.
    // Keep that source even when another Agent also references the same workspace.
    const preserveExactSource =
      exactSourceOwners?.some(
        (owner) => owner.sourceAgentId === sourceAgentId && owner.finalAgentId === finalAgentId
      ) ?? false
    targetPaths.set(targetPath, { path: targetPath, exists: false, preserveExactSource })
  }
  for (const session of input.sessions) {
    if (!session.isManagedDefault || !session.systemWorkspacePath) continue
    const targetPath = path.resolve(session.systemWorkspacePath)
    targetPaths.set(targetPath, { path: targetPath, exists: false, preserveExactSource: false })
  }

  const normalizedRoot = path.resolve(input.agentsDataRoot)
  const targets = Array.from(targetPaths.values())
  for (const target of targets) {
    if (target.path === normalizedRoot || !isPathInside(target.path, normalizedRoot)) {
      throw new Error(`Legacy Agent migration cleanup target escapes its root: ${target.path}`)
    }
    await assertAgentStoragePath(input.agentsDataRoot, path.dirname(target.path))
    target.exists = Boolean(await lstatIfExists(target.path))
  }

  const lexicalTargets = targets.map((target) => ({ indexedPath: target.path, ownerPath: target.path }))
  const lexicalTargetIndex = createCleanupTargetAncestorIndex(lexicalTargets)
  const preservedSourceKeys = new Set(
    targets.filter((target) => target.preserveExactSource).map((target) => cleanupPathIndexKey(target.path))
  )

  const sourcePaths = new Set(
    input.sessions
      .map((session) => path.resolve(session.sourceWorkspacePath))
      .concat(
        input.agents.map(({ sourceAgentId }) =>
          path.resolve(legacyAgentWorkspacePath(input.agentsDataRoot, sourceAgentId))
        )
      )
  )
  const overlapSourcePaths = Array.from(sourcePaths).filter(
    (sourcePath) => !preservedSourceKeys.has(cleanupPathIndexKey(sourcePath))
  )
  const lexicalSources = overlapSourcePaths.map((sourcePath) => ({ indexedPath: sourcePath, ownerPath: sourcePath }))
  const targetSourceOverlaps = new Map<string, CleanupTargetSourceOverlap>()
  for (const overlap of findCleanupTargetSourceOverlaps(lexicalTargets, lexicalTargetIndex, lexicalSources)) {
    targetSourceOverlaps.set(cleanupPathIndexKey(overlap.targetPath), overlap)
  }

  const skippedTargetKeys = new Set<string>()
  const resolvedSources: CleanupPathIndexEntry[] = []
  for (const sourcePath of overlapSourcePaths) {
    try {
      const resolvedSource = await realpathIfExists(sourcePath)
      if (resolvedSource) resolvedSources.push({ indexedPath: resolvedSource, ownerPath: sourcePath })
    } catch (error) {
      if (isSameOrInside(sourcePath, normalizedRoot) || !isUnknownRealpathError(error)) {
        throw error
      }
      const protectedTargetKeys = new Set(
        targetKeysBySourcePath.get(cleanupPathIndexKey(sourcePath)) ?? new Set<string>()
      )
      for (const target of targets) {
        if (target.exists) protectedTargetKeys.add(cleanupPathIndexKey(target.path))
      }
      for (const targetKey of protectedTargetKeys) skippedTargetKeys.add(targetKey)
      logger.warn('Skipping Agent filesystem targets because an external legacy source cannot be resolved', {
        sourcePath,
        code: error.code,
        syscall: error.syscall,
        skippedTargets: protectedTargetKeys.size
      })
    }
  }

  const resolvedTargets: CleanupPathIndexEntry[] = []
  for (const target of targets) {
    resolvedTargets.push({
      indexedPath: await resolveRealOrNearestExistingPath(target.path),
      ownerPath: target.path
    })
  }
  const resolvedTargetIndex = createCleanupPathAncestorIndex(resolvedTargets)
  for (const overlap of findCleanupTargetSourceOverlaps(resolvedTargets, resolvedTargetIndex, resolvedSources)) {
    const key = cleanupPathIndexKey(overlap.targetPath)
    if (!targetSourceOverlaps.has(key)) targetSourceOverlaps.set(key, overlap)
  }

  for (const overlap of targetSourceOverlaps.values()) {
    logger.warn('Skipping Agent filesystem target because it overlaps a legacy source', overlap)
  }

  for (const targetKey of targetSourceOverlaps.keys()) skippedTargetKeys.add(targetKey)
  const cleanupTargets = targets.filter(
    (target) => !target.preserveExactSource && !skippedTargetKeys.has(cleanupPathIndexKey(target.path))
  )
  for (const target of cleanupTargets) {
    await removeTreeWithoutFollowing(target.path)
  }

  logger.info('Cleared stale Agent migration filesystem targets before copying', {
    targets: cleanupTargets.length,
    removedTargets: cleanupTargets.filter((target) => target.exists).length,
    preservedSources: targets.length - cleanupTargets.length,
    skippedTargets: skippedTargetKeys.size
  })
  return skippedTargetKeys
}

export async function stageLegacyAgentFiles(input: {
  agentsDataRoot: string
  agents: Array<{ sourceAgentId: string; finalAgentId: string }>
  sessions: AgentFileSessionPlan[]
  onProgress?: (progress: AgentFilesystemMigrationProgress) => void
}): Promise<AgentFilesystemMigrationResult> {
  const startedAt = performance.now()
  if (input.agents.length === 0) {
    logger.info('Prepared Agent identity and workspace files', {
      agents: 0,
      sessions: 0,
      durationMs: Math.round(performance.now() - startedAt)
    })
    return { skippedTargetCount: 0 }
  }

  const skippedTargetKeys = await clearLegacyAgentMigrationTargets(input)

  const plansByAgent = new Map<string, AgentFileSessionPlan[]>()
  for (const session of input.sessions) {
    const plans = plansByAgent.get(session.sourceAgentId) ?? []
    plans.push(session)
    plansByAgent.set(session.sourceAgentId, plans)
  }

  const workspaceCopyContext: WorkspaceCopyContext = {
    sourceSnapshots: new Map(),
    reusableStagingPaths: new Map(),
    pendingPublications: []
  }

  // A v1 managed-default workspace was SHARED by every session of the agent.
  // v2 gives each session its own exclusive system workspace, so copying that
  // shared tree into all of them fanned one source out into N full copies and
  // exhausted the disk (issue #17830). Materialize the shared content once, into
  // the single most recently active session; the other sessions keep the empty
  // system workspace directories they still get created below.
  const contentSessionIdByAgent = new Map<string, string>()
  for (const { sourceAgentId } of input.agents) {
    const systemSessions = (plansByAgent.get(sourceAgentId) ?? []).filter(
      (plan) => plan.isManagedDefault && plan.systemWorkspacePath
    )
    if (systemSessions.length === 0) continue
    const latest = systemSessions.reduce((best, session) => (isLaterManagedSession(session, best) ? session : best))
    contentSessionIdByAgent.set(sourceAgentId, latest.sourceSessionId)
  }
  const totalWorkspaceSessions = contentSessionIdByAgent.size
  let processedAgents = 0
  let processedWorkspaceSessions = 0
  let identityFileCount = 0
  let identityByteCount = 0
  let workspaceFileCount = 0
  let workspaceByteCount = 0
  let copiedWorkspaceEntries = 0
  let reusedWorkspaceEntries = 0

  try {
    for (const { sourceAgentId, finalAgentId } of input.agents) {
      const agentPlans = plansByAgent.get(sourceAgentId) ?? []
      const agentDataPath = agentDataDirectoryPath(input.agentsDataRoot, finalAgentId)
      const skipAgentTarget = skippedTargetKeys.has(cleanupPathIndexKey(agentDataPath))
      if (!skipAgentTarget) await ensureAgentStorageDirectory(input.agentsDataRoot, agentDataPath)
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

      if (!skipAgentTarget) {
        const seenSources = new Set<string>()
        const claimedIdentityEntries = new Set<string>()
        for (const sourcePath of orderedSources) {
          const normalizedSource = path.resolve(sourcePath)
          if (seenSources.has(normalizedSource)) continue
          seenSources.add(normalizedSource)
          const identityStats = await copyIdentityFromWorkspace(sourcePath, agentDataPath, claimedIdentityEntries)
          identityFileCount += identityStats.fileCount
          identityByteCount += identityStats.byteCount
        }
      }

      processedAgents++
      input.onProgress?.({
        phase: 'identity',
        processed: processedAgents,
        total: input.agents.length,
        fileCount: identityFileCount,
        byteCount: identityByteCount
      })

      if (!skipAgentTarget) await ensureAgentDataDirectory(input.agentsDataRoot, finalAgentId)

      const systemSessions = agentPlans.filter((plan) => plan.isManagedDefault && plan.systemWorkspacePath)
      for (const session of systemSessions) {
        if (session.systemWorkspacePath && !skippedTargetKeys.has(cleanupPathIndexKey(session.systemWorkspacePath))) {
          await ensureAgentStorageDirectory(input.agentsDataRoot, session.systemWorkspacePath)
        }
      }

      if (path.resolve(defaultWorkspacePath) === path.resolve(agentDataPath)) continue

      const contentSessionId = contentSessionIdByAgent.get(sourceAgentId)
      const contentSession = systemSessions.find((session) => session.sourceSessionId === contentSessionId)
      if (!contentSession?.systemWorkspacePath) continue

      if (skippedTargetKeys.has(cleanupPathIndexKey(contentSession.systemWorkspacePath))) {
        processedWorkspaceSessions++
        input.onProgress?.({
          phase: 'workspace',
          processed: processedWorkspaceSessions,
          total: totalWorkspaceSessions,
          fileCount: workspaceFileCount,
          byteCount: workspaceByteCount
        })
        continue
      }

      const workspaceStats = await copyOrdinaryWorkspaceContent(
        workspaceCopyContext,
        input.agentsDataRoot,
        contentSession.sourceWorkspacePath,
        contentSession.systemWorkspacePath
      )
      copiedWorkspaceEntries += workspaceStats.copiedEntries
      reusedWorkspaceEntries += workspaceStats.reusedEntries
      workspaceFileCount += workspaceStats.fileCount
      workspaceByteCount += workspaceStats.byteCount
      processedWorkspaceSessions++
      input.onProgress?.({
        phase: 'workspace',
        processed: processedWorkspaceSessions,
        total: totalWorkspaceSessions,
        fileCount: workspaceFileCount,
        byteCount: workspaceByteCount
      })
    }
    const publicationStats = await publishPreparedWorkspaceEntries(workspaceCopyContext)
    copiedWorkspaceEntries = publicationStats.publishedEntries
    reusedWorkspaceEntries += publicationStats.reusedEntries
  } finally {
    for (const publication of workspaceCopyContext.pendingPublications) {
      await removeTreeWithoutFollowing(publication.stagingPath).catch(() => undefined)
    }
  }

  logger.info('Prepared Agent identity and workspace files', {
    agents: input.agents.length,
    sessions: processedWorkspaceSessions,
    uniqueWorkspaceEntries: workspaceCopyContext.sourceSnapshots.size,
    copiedWorkspaceEntries,
    reusedWorkspaceEntries,
    identityFileCount,
    identityByteCount,
    workspaceFileCount,
    workspaceByteCount,
    durationMs: Math.round(performance.now() - startedAt)
  })
  return { skippedTargetCount: skippedTargetKeys.size }
}
