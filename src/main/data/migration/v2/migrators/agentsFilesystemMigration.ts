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
  assertAgentStoragePath,
  ensureAgentDataDirectory,
  ensureAgentStorageDirectory
} from '@main/ai/agents/agentDataDirectory'
import { isPathInside } from '@main/utils/file'

const logger = loggerService.withContext('AgentsFilesystemMigration')
const IDENTITY_ENTRY_NAMES = new Set(['soul.md', 'user.md', 'memory'])

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
  createdAt: number
  updatedAt: number
}

export interface LegacyAgentFilesCleanupPlan {
  agentsDataRoot: string
  workspaces: Array<{
    workspacePath: string
    entries: Array<{
      entryName: string
      sourceFingerprint: string
      sourceMetadataFingerprint: string
      destinationPath: string
      destinationFingerprint: string
      destinationMetadataFingerprint: string
    }>
  }>
}

interface LegacyAgentFilesCleanupCandidate {
  entryName: string
  destinationPath: string
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
    if (
      destinationStat.isFile() &&
      !destinationStat.isSymbolicLink() &&
      sourceStat.size === destinationStat.size &&
      (await fileDigest(sourcePath)) === (await fileDigest(destinationPath))
    ) {
      return true
    }
    logger.warn('Keeping legacy identity file because the existing target differs', { sourcePath, destinationPath })
    return false
  }

  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
  return true
}

async function copyIdentityFromWorkspace(
  sourceWorkspacePath: string,
  agentDataPath: string,
  allowCleanup: boolean
): Promise<LegacyAgentFilesCleanupCandidate[]> {
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

  const cleanupEntries: LegacyAgentFilesCleanupCandidate[] = []
  for (const name of ['SOUL.md', 'USER.md', 'memory']) {
    const sourcePath = await findCaseInsensitiveEntry(effectiveWorkspacePath, name)
    if (!sourcePath) continue
    const destinationPath = path.join(agentDataPath, name)
    const copied = await materializeIdentityEntry(sourcePath, destinationPath, effectiveWorkspacePath)
    if (copied && canCleanup) {
      cleanupEntries.push({
        entryName: path.basename(sourcePath),
        destinationPath
      })
    }
  }
  return cleanupEntries
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

async function rewriteCopiedWorkspaceLinks(
  sourcePath: string,
  copiedPath: string,
  finalDestinationPath: string,
  sourceWorkspaceRoot: string,
  destinationWorkspaceRoot: string,
  agentDataPath: string
): Promise<void> {
  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink()) {
    const linkTarget = await readlink(sourcePath)
    let linkType: 'dir' | 'file' = 'file'
    try {
      if ((await stat(sourcePath)).isDirectory()) linkType = 'dir'
    } catch {
      // Dangling links retain their text and use the file default on Windows.
    }
    await unlink(copiedPath)
    await symlink(
      migratedLinkTarget(
        sourcePath,
        finalDestinationPath,
        linkTarget,
        sourceWorkspaceRoot,
        destinationWorkspaceRoot,
        agentDataPath
      ),
      copiedPath,
      linkType
    )
    return
  }
  if (sourceStat.isDirectory()) {
    for (const entry of await readdir(sourcePath)) {
      await rewriteCopiedWorkspaceLinks(
        path.join(sourcePath, entry),
        path.join(copiedPath, entry),
        path.join(finalDestinationPath, entry),
        sourceWorkspaceRoot,
        destinationWorkspaceRoot,
        agentDataPath
      )
    }
  }
}

async function copyWorkspaceEntryPreservingLinks(
  sourcePath: string,
  destinationPath: string,
  finalDestinationPath: string,
  sourceWorkspaceRoot: string,
  destinationWorkspaceRoot: string,
  agentDataPath: string
): Promise<void> {
  await cp(sourcePath, destinationPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE
  })
  await rewriteCopiedWorkspaceLinks(
    sourcePath,
    destinationPath,
    finalDestinationPath,
    sourceWorkspaceRoot,
    destinationWorkspaceRoot,
    agentDataPath
  )
}

async function fileDigest(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

type FilesystemEntryKind = 'directory' | 'file' | 'symlink'

interface FilesystemEntrySnapshot {
  fingerprint: string
  metadataFingerprint: string
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

async function filesystemEntrySnapshot(targetPath: string): Promise<FilesystemEntrySnapshot | undefined> {
  const targetStat = await lstatBigIntIfExists(targetPath)
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  const contentHash = createHash('sha256')
  const metadataHash = initializeMetadataFingerprint(targetStat)
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
      const childSnapshot = await filesystemEntrySnapshot(path.join(targetPath, entry))
      if (!childSnapshot) {
        throw new Error(`Agent migration fingerprint source disappeared: ${path.join(targetPath, entry)}`)
      }
      updateFingerprintField(contentHash, entry)
      updateFingerprintField(contentHash, childSnapshot.fingerprint)
      updateFingerprintField(metadataHash, entry)
      updateFingerprintField(metadataHash, childSnapshot.metadataFingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(targetPath, targetStat)
  return {
    fingerprint: contentHash.digest('hex'),
    metadataFingerprint: metadataHash.digest('hex')
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

async function requiredFilesystemEntrySnapshot(targetPath: string): Promise<FilesystemEntrySnapshot> {
  const snapshot = await filesystemEntrySnapshot(targetPath)
  if (!snapshot) {
    throw new Error(`Agent migration fingerprint source disappeared: ${targetPath}`)
  }
  return snapshot
}

async function filesystemEntryMatchesSnapshot(
  targetPath: string,
  expectedFingerprint: string,
  expectedMetadataFingerprint: string
): Promise<boolean> {
  const metadataFingerprint = await filesystemEntryMetadataFingerprint(targetPath)
  if (!metadataFingerprint) return false
  if (metadataFingerprint === expectedMetadataFingerprint) return true
  return (await filesystemEntrySnapshot(targetPath))?.fingerprint === expectedFingerprint
}

async function workspaceEntriesEqual(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([lstatIfExists(leftPath), lstatIfExists(rightPath)])
  if (!leftStat || !rightStat) return false

  if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) {
    return (
      leftStat.isSymbolicLink() &&
      rightStat.isSymbolicLink() &&
      (await readlink(leftPath)) === (await readlink(rightPath))
    )
  }
  if (leftStat.isFile() || rightStat.isFile()) {
    if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false
    const [leftDigest, rightDigest] = await Promise.all([fileDigest(leftPath), fileDigest(rightPath)])
    return leftDigest === rightDigest
  }
  if (!leftStat.isDirectory() || !rightStat.isDirectory()) return false

  const [leftEntries, rightEntries] = await Promise.all([readdir(leftPath), readdir(rightPath)])
  leftEntries.sort()
  rightEntries.sort()
  if (leftEntries.length !== rightEntries.length || leftEntries.some((entry, index) => entry !== rightEntries[index])) {
    return false
  }
  for (const entry of leftEntries) {
    if (!(await workspaceEntriesEqual(path.join(leftPath, entry), path.join(rightPath, entry)))) return false
  }
  return true
}

async function removeStaleWorkspaceStagingEntries(destinationWorkspaceRoot: string): Promise<void> {
  const stagingParent = path.dirname(destinationWorkspaceRoot)
  const stagingPrefix = `.${path.basename(destinationWorkspaceRoot)}.migration-`
  for (const entry of await readdir(stagingParent)) {
    if (entry.startsWith(stagingPrefix)) {
      await removeTreeWithoutFollowing(path.join(stagingParent, entry))
    }
  }
}

async function publishStagedWorkspaceEntry(stagingPath: string, destinationPath: string): Promise<void> {
  const stagingStat = await lstat(stagingPath)
  if (stagingStat.isSymbolicLink()) {
    let linkType: 'dir' | 'file' = 'file'
    try {
      if ((await stat(stagingPath)).isDirectory()) linkType = 'dir'
    } catch {
      // Dangling links use the file default on Windows.
    }
    await symlink(await readlink(stagingPath), destinationPath, linkType)
    return
  }
  if (stagingStat.isFile()) {
    // A hard-link publish is atomic and fails if the target appears concurrently.
    // The staging entry is on the same managed volume and is unlinked in `finally`.
    await link(stagingPath, destinationPath)
    return
  }
  if (stagingStat.isDirectory()) {
    // Renaming a directory fails rather than replacing an existing destination directory.
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
  await removeStaleWorkspaceStagingEntries(destinationWorkspaceRoot)
  const stagingPath = path.join(
    path.dirname(destinationWorkspaceRoot),
    `.${path.basename(destinationWorkspaceRoot)}.migration-${randomUUID()}`
  )
  try {
    await copyWorkspaceEntryPreservingLinks(
      sourcePath,
      stagingPath,
      destinationPath,
      sourceWorkspaceRoot,
      destinationWorkspaceRoot,
      agentDataPath
    )

    if (await lstatIfExists(destinationPath)) {
      if (await workspaceEntriesEqual(stagingPath, destinationPath)) {
        logger.info('Reusing identical workspace entry from an earlier migration attempt', {
          sourcePath,
          destinationPath
        })
        return
      }
      throw new Error(`Legacy workspace migration conflict at ${destinationPath}`)
    }

    try {
      await publishStagedWorkspaceEntry(stagingPath, destinationPath)
    } catch (error) {
      if ((await lstatIfExists(destinationPath)) && (await workspaceEntriesEqual(stagingPath, destinationPath))) {
        return
      }
      throw error
    }
  } finally {
    await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
  }
}

async function copyOrdinaryWorkspaceContent(
  agentsDataRoot: string,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string,
  agentDataPath: string
): Promise<LegacyAgentFilesCleanupCandidate[]> {
  const sourceStat = await lstatIfExists(sourceWorkspacePath)
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) return []

  await ensureAgentStorageDirectory(agentsDataRoot, destinationWorkspacePath)
  const cleanupEntries: LegacyAgentFilesCleanupCandidate[] = []
  for (const entry of await readdir(sourceWorkspacePath)) {
    if (IDENTITY_ENTRY_NAMES.has(entry.toLowerCase())) continue
    const destinationPath = path.join(destinationWorkspacePath, entry)
    await copyWorkspaceEntry(
      path.join(sourceWorkspacePath, entry),
      destinationPath,
      sourceWorkspacePath,
      destinationWorkspacePath,
      agentDataPath
    )
    cleanupEntries.push({ entryName: entry, destinationPath })
  }
  return cleanupEntries
}

function addCleanupEntries(
  cleanupByWorkspace: Map<string, Map<string, string>>,
  workspacePath: string,
  cleanupEntries: LegacyAgentFilesCleanupCandidate[]
): void {
  if (cleanupEntries.length === 0) return
  const entries = cleanupByWorkspace.get(workspacePath) ?? new Map<string, string>()
  for (const { entryName, destinationPath } of cleanupEntries) {
    const existingDestination = entries.get(entryName)
    if (existingDestination && path.resolve(existingDestination) !== path.resolve(destinationPath)) {
      throw new Error(`Legacy Agent cleanup entry was copied to multiple destinations: ${entryName}`)
    }
    entries.set(entryName, destinationPath)
  }
  cleanupByWorkspace.set(workspacePath, entries)
}

export async function stageLegacyAgentFiles(input: {
  agentsDataRoot: string
  agents: Array<{ sourceAgentId: string; finalAgentId: string }>
  sessions: AgentFileSessionPlan[]
}): Promise<LegacyAgentFilesCleanupPlan> {
  const cleanupByWorkspace = new Map<string, Map<string, string>>()
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
        latestSystemSession.systemWorkspacePath,
        agentDataPath
      )
      addCleanupEntries(cleanupByWorkspace, defaultWorkspacePath, copiedEntries)
    }
  }

  const workspaces: LegacyAgentFilesCleanupPlan['workspaces'] = []
  for (const [workspacePath, cleanupEntries] of cleanupByWorkspace) {
    const entries: LegacyAgentFilesCleanupPlan['workspaces'][number]['entries'] = []
    for (const [entryName, destinationPath] of cleanupEntries) {
      const sourceSnapshot = await requiredFilesystemEntrySnapshot(path.join(workspacePath, entryName))
      const destinationSnapshot = await requiredFilesystemEntrySnapshot(destinationPath)
      entries.push({
        entryName,
        sourceFingerprint: sourceSnapshot.fingerprint,
        sourceMetadataFingerprint: sourceSnapshot.metadataFingerprint,
        destinationPath,
        destinationFingerprint: destinationSnapshot.fingerprint,
        destinationMetadataFingerprint: destinationSnapshot.metadataFingerprint
      })
    }
    workspaces.push({ workspacePath, entries })
  }
  return { agentsDataRoot: input.agentsDataRoot, workspaces }
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
    for (const entry of workspace.entries) {
      const { entryName } = entry
      if (!entryName || entryName === '.' || entryName === '..' || /[\\/]/.test(entryName)) {
        logger.warn('Skipping invalid legacy agent cleanup entry', {
          workspacePath: workspace.workspacePath,
          entryName
        })
        continue
      }

      const destinationPath = path.resolve(entry.destinationPath)
      const agentsDataRoot = path.resolve(plan.agentsDataRoot)
      if (!isPathInside(destinationPath, agentsDataRoot)) {
        logger.warn('Skipping legacy agent cleanup because its destination escapes the Agent storage root', {
          workspacePath: workspace.workspacePath,
          entryName,
          destinationPath
        })
        continue
      }
      await assertAgentStoragePath(plan.agentsDataRoot, path.dirname(destinationPath))

      const destinationMatches = await filesystemEntryMatchesSnapshot(
        destinationPath,
        entry.destinationFingerprint,
        entry.destinationMetadataFingerprint
      )
      if (!destinationMatches) {
        logger.warn('Keeping legacy Agent entry because its migrated destination changed or disappeared', {
          workspacePath: workspace.workspacePath,
          entryName,
          destinationPath
        })
        continue
      }

      const sourcePath = path.join(workspace.workspacePath, entryName)
      const sourceMatches = await filesystemEntryMatchesSnapshot(
        sourcePath,
        entry.sourceFingerprint,
        entry.sourceMetadataFingerprint
      )
      if (!sourceMatches) {
        logger.warn('Keeping legacy Agent entry because its source changed after migration staging', {
          workspacePath: workspace.workspacePath,
          entryName
        })
        continue
      }

      await removeTreeWithoutFollowing(sourcePath)
    }
    await rmdir(workspace.workspacePath).catch(() => undefined)
  }
}
