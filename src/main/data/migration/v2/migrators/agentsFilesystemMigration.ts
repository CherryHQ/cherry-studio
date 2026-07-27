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
      sourceVerification: 'identity' | 'raw'
      destinationPath: string
      copiedFingerprint: string
      destinationMetadataFingerprint: string
    }>
  }>
}

interface LegacyAgentFilesCleanupCandidate {
  entryName: string
  sourceFingerprint: string
  sourceMetadataFingerprint: string
  sourceVerification: 'identity' | 'raw'
  destinationPath: string
  copiedFingerprint: string
  destinationMetadataFingerprint: string
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

  if (sourceStat.isDirectory()) {
    await mkdir(destinationPath)

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

  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
  return true
}

async function copyIdentityEntry(
  sourcePath: string,
  destinationPath: string,
  sourceWorkspaceRoot: string
): Promise<LegacyAgentFilesCleanupCandidate | undefined> {
  const sourceSnapshot = await identityCopySourceSnapshot(sourcePath, sourceWorkspaceRoot)
  if (!sourceSnapshot) return undefined

  const stagingPrefix = `.${path.basename(destinationPath)}.migration-`
  await removeStaleStagingEntries(path.dirname(destinationPath), stagingPrefix)
  const stagingPath = path.join(path.dirname(destinationPath), `${stagingPrefix}${randomUUID()}`)

  try {
    if (!(await materializeIdentityEntry(sourcePath, stagingPath, sourceWorkspaceRoot))) return undefined

    const sourceMetadataFingerprint = await identitySourceMetadataFingerprint(sourcePath, sourceWorkspaceRoot)
    if (sourceMetadataFingerprint !== sourceSnapshot.metadataFingerprint) {
      throw new Error(`Legacy Agent identity changed while being copied: ${sourcePath}`)
    }

    const stagingSnapshot = await requiredFilesystemEntrySnapshot(stagingPath)
    if (stagingSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
      throw new Error(`Legacy Agent identity copy verification failed: ${sourcePath}`)
    }

    let destinationSnapshot = await filesystemEntrySnapshot(destinationPath)
    if (destinationSnapshot) {
      if (destinationSnapshot.fingerprint !== sourceSnapshot.copiedFingerprint) {
        logger.warn('Keeping legacy identity entry because the existing target differs', {
          sourcePath,
          destinationPath
        })
        return undefined
      }
      logger.info('Reusing identical identity entry from an earlier migration attempt', {
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
      throw new Error(`Legacy Agent identity changed while being published: ${destinationPath}`)
    }
    return {
      entryName: path.basename(sourcePath),
      sourceFingerprint: sourceSnapshot.sourceFingerprint,
      sourceMetadataFingerprint: sourceSnapshot.metadataFingerprint,
      sourceVerification: 'identity',
      destinationPath,
      copiedFingerprint: sourceSnapshot.copiedFingerprint,
      destinationMetadataFingerprint: destinationSnapshot.metadataFingerprint
    }
  } finally {
    await removeTreeWithoutFollowing(stagingPath).catch(() => undefined)
  }
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
    const cleanupEntry = await copyIdentityEntry(sourcePath, destinationPath, effectiveWorkspacePath)
    if (cleanupEntry && canCleanup) cleanupEntries.push(cleanupEntry)
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

type FilesystemEntryKind = 'directory' | 'file' | 'symlink'

interface FilesystemEntrySnapshot {
  fingerprint: string
  metadataFingerprint: string
}

interface CopySourceSnapshot {
  sourceFingerprint: string
  copiedFingerprint: string
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

async function identityCopySourceSnapshot(
  targetPath: string,
  sourceWorkspaceRoot: string,
  visitedRealPaths = new Set<string>(),
  realWorkspaceRoot?: string
): Promise<CopySourceSnapshot | undefined> {
  const targetStat = await lstatBigIntIfExists(targetPath)
  if (!targetStat) return undefined

  const kind = filesystemEntryKind(targetStat)
  const sourceHash = createHash('sha256')
  const copiedHash = createHash('sha256')
  const metadataHash = initializeMetadataFingerprint(targetStat)
  updateFingerprintField(sourceHash, kind)

  if (kind === 'symlink') {
    updateFingerprintField(sourceHash, await readlink(targetPath))
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
    const resolvedSnapshot = await identityCopySourceSnapshot(
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
      sourceFingerprint: sourceHash.digest('hex'),
      copiedFingerprint: resolvedSnapshot.copiedFingerprint,
      metadataFingerprint: metadataHash.digest('hex')
    }
  }

  updateFingerprintField(copiedHash, kind)
  if (kind === 'file') {
    for await (const chunk of createReadStream(targetPath)) {
      sourceHash.update(chunk)
      copiedHash.update(chunk)
    }
  } else {
    const entries = await readdir(targetPath)
    entries.sort()
    for (const entry of entries) {
      const childSnapshot = await identityCopySourceSnapshot(
        path.join(targetPath, entry),
        sourceWorkspaceRoot,
        visitedRealPaths,
        realWorkspaceRoot
      )
      if (!childSnapshot) return undefined
      updateFingerprintField(sourceHash, entry)
      updateFingerprintField(sourceHash, childSnapshot.sourceFingerprint)
      updateFingerprintField(copiedHash, entry)
      updateFingerprintField(copiedHash, childSnapshot.copiedFingerprint)
      updateFingerprintField(metadataHash, entry)
      updateFingerprintField(metadataHash, childSnapshot.metadataFingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(targetPath, targetStat)
  return {
    sourceFingerprint: sourceHash.digest('hex'),
    copiedFingerprint: copiedHash.digest('hex'),
    metadataFingerprint: metadataHash.digest('hex')
  }
}

async function identitySourceMetadataFingerprint(
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
    const resolvedFingerprint = await identitySourceMetadataFingerprint(
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
      const childFingerprint = await identitySourceMetadataFingerprint(
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
  const sourceHash = createHash('sha256')
  const copiedHash = createHash('sha256')
  const metadataHash = initializeMetadataFingerprint(sourceStat)
  updateFingerprintField(sourceHash, kind)
  updateFingerprintField(copiedHash, kind)

  if (kind === 'symlink') {
    const linkTarget = await readlink(sourcePath)
    updateFingerprintField(sourceHash, linkTarget)
    updateFingerprintField(
      copiedHash,
      migratedLinkTarget(
        sourcePath,
        finalDestinationPath,
        linkTarget,
        sourceWorkspaceRoot,
        destinationWorkspaceRoot,
        agentDataPath
      )
    )
  } else if (kind === 'file') {
    for await (const chunk of createReadStream(sourcePath)) {
      sourceHash.update(chunk)
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
      updateFingerprintField(sourceHash, entry)
      updateFingerprintField(sourceHash, childSnapshot.sourceFingerprint)
      updateFingerprintField(copiedHash, entry)
      updateFingerprintField(copiedHash, childSnapshot.copiedFingerprint)
      updateFingerprintField(metadataHash, entry)
      updateFingerprintField(metadataHash, childSnapshot.metadataFingerprint)
    }
  }

  await assertFilesystemEntryUnchanged(sourcePath, sourceStat)
  return {
    sourceFingerprint: sourceHash.digest('hex'),
    copiedFingerprint: copiedHash.digest('hex'),
    metadataFingerprint: metadataHash.digest('hex')
  }
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

async function removeStaleStagingEntries(stagingParent: string, stagingPrefix: string): Promise<void> {
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
): Promise<LegacyAgentFilesCleanupCandidate> {
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
  await removeStaleStagingEntries(stagingParent, stagingPrefix)
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
      throw new Error(`Legacy Agent workspace entry changed while being published: ${destinationPath}`)
    }
    return {
      entryName: path.basename(sourcePath),
      sourceFingerprint: sourceSnapshot.sourceFingerprint,
      sourceMetadataFingerprint: sourceSnapshot.metadataFingerprint,
      sourceVerification: 'raw',
      destinationPath,
      copiedFingerprint: sourceSnapshot.copiedFingerprint,
      destinationMetadataFingerprint: destinationSnapshot.metadataFingerprint
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
    cleanupEntries.push(
      await copyWorkspaceEntry(
        path.join(sourceWorkspacePath, entry),
        destinationPath,
        sourceWorkspacePath,
        destinationWorkspacePath,
        agentDataPath
      )
    )
  }
  return cleanupEntries
}

function addCleanupEntries(
  cleanupByWorkspace: Map<string, Map<string, LegacyAgentFilesCleanupCandidate>>,
  workspacePath: string,
  cleanupEntries: LegacyAgentFilesCleanupCandidate[]
): void {
  if (cleanupEntries.length === 0) return
  const entries = cleanupByWorkspace.get(workspacePath) ?? new Map<string, LegacyAgentFilesCleanupCandidate>()
  for (const entry of cleanupEntries) {
    const existing = entries.get(entry.entryName)
    if (existing && path.resolve(existing.destinationPath) !== path.resolve(entry.destinationPath)) {
      throw new Error(`Legacy Agent cleanup entry was copied to multiple destinations: ${entry.entryName}`)
    }
    entries.set(entry.entryName, entry)
  }
  cleanupByWorkspace.set(workspacePath, entries)
}

export async function stageLegacyAgentFiles(input: {
  agentsDataRoot: string
  agents: Array<{ sourceAgentId: string; finalAgentId: string }>
  sessions: AgentFileSessionPlan[]
}): Promise<LegacyAgentFilesCleanupPlan> {
  const cleanupByWorkspace = new Map<string, Map<string, LegacyAgentFilesCleanupCandidate>>()
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
    entries.push(...cleanupEntries.values())
    workspaces.push({ workspacePath, entries })
  }
  return { agentsDataRoot: input.agentsDataRoot, workspaces }
}

/**
 * Remove only source entries that were successfully copied during staging.
 * Called after the engine has verified all migrators, but before it persists
 * the completed marker. Failures keep the migration retryable.
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
        entry.copiedFingerprint,
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
      let sourceMatches: boolean
      if (entry.sourceVerification === 'identity') {
        const metadataFingerprint = await identitySourceMetadataFingerprint(sourcePath, workspace.workspacePath)
        sourceMatches =
          metadataFingerprint === entry.sourceMetadataFingerprint ||
          (await identityCopySourceSnapshot(sourcePath, workspace.workspacePath))?.copiedFingerprint ===
            entry.copiedFingerprint
      } else {
        sourceMatches = await filesystemEntryMatchesSnapshot(
          sourcePath,
          entry.sourceFingerprint,
          entry.sourceMetadataFingerprint
        )
      }
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
