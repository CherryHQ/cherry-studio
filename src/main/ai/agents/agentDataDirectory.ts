import { open } from 'node:fs/promises'
import path from 'node:path'

import { ensureDir, isPathInside, lstat, mkdir, realpath, removeDir } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

const AGENT_DATA_FILES = ['SOUL.md', 'USER.md'] as const

function asAbsolutePath(value: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(value)
}

async function lstatIfExists(targetPath: string) {
  try {
    return await lstat(asAbsolutePath(targetPath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function resolveRealOrNearestExistingPath(targetPath: AbsoluteFilePath): Promise<AbsoluteFilePath> {
  try {
    return await realpath(targetPath)
  } catch {
    let currentPath = asAbsolutePath(path.dirname(targetPath))

    while (true) {
      try {
        const realCurrentPath = await realpath(currentPath)
        return asAbsolutePath(path.normalize(path.join(realCurrentPath, path.relative(currentPath, targetPath))))
      } catch {
        const parentPath = asAbsolutePath(path.dirname(currentPath))
        if (parentPath === currentPath) return asAbsolutePath(path.normalize(targetPath))
        currentPath = parentPath
      }
    }
  }
}

/**
 * Validate a path in Data/Agents without following symbolic links in the
 * managed root or any path component below it.
 */
export async function assertAgentStoragePath(agentsDataRoot: string, targetPath: string): Promise<void> {
  const root = asAbsolutePath(path.resolve(agentsDataRoot))
  const target = asAbsolutePath(path.resolve(targetPath))
  if (target !== root && !isPathInside(target, root)) {
    throw new Error(`Agent storage path escapes its root: ${target}`)
  }

  const rootStat = await lstatIfExists(root)
  if (!rootStat?.isDirectory || rootStat.isSymbolicLink) {
    throw new Error(`Agent storage root must be a real directory: ${root}`)
  }

  let current = root
  const relative = path.relative(root, target)
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = asAbsolutePath(path.join(current, segment))
    const currentStat = await lstatIfExists(current)
    if (!currentStat) break
    if (currentStat.isSymbolicLink) {
      throw new Error(`Agent storage path contains a symbolic link: ${current}`)
    }
    if (current !== target && !currentStat.isDirectory) {
      throw new Error(`Agent storage path parent is not a directory: ${current}`)
    }
  }

  const [realRoot, realTarget] = await Promise.all([
    resolveRealOrNearestExistingPath(root),
    resolveRealOrNearestExistingPath(target)
  ])
  if (realTarget !== realRoot && !isPathInside(realTarget, realRoot)) {
    throw new Error(`Agent storage path resolves outside its root: ${target}`)
  }
}

/** Ensure a Data/Agents path is a real directory contained by the Agent storage root. */
export async function ensureAgentStorageDirectory(agentsDataRoot: string, targetPath: string): Promise<void> {
  await ensureDir(asAbsolutePath(path.resolve(agentsDataRoot)))
  await assertAgentStoragePath(agentsDataRoot, targetPath)
  await ensureDir(asAbsolutePath(path.resolve(targetPath)))
  await assertAgentStoragePath(agentsDataRoot, targetPath)
  const targetStat = await lstat(asAbsolutePath(path.resolve(targetPath)))
  if (!targetStat.isDirectory || targetStat.isSymbolicLink) {
    throw new Error(`Agent storage directory must be a real directory: ${targetPath}`)
  }
}

function assertAgentId(agentId: string): void {
  if (!agentId || agentId === '.' || agentId === '..' || agentId.toLowerCase() === 'system' || /[\\/]/.test(agentId)) {
    throw new Error(`Invalid agent id for data directory: ${agentId}`)
  }
}

export function agentDataDirectoryPath(agentsDataRoot: string, agentId: string): string {
  assertAgentId(agentId)
  return path.join(agentsDataRoot, agentId)
}

async function ensureEmptyFile(filePath: string): Promise<void> {
  const existing = await lstatIfExists(filePath)
  if (existing) {
    if (!existing.isFile || existing.isSymbolicLink) {
      throw new Error(`Agent data file must be a real file: ${filePath}`)
    }
    return
  }
  const handle = await open(filePath, 'wx', 0o600)
  await handle.close()
}

export async function ensureAgentDataDirectory(
  agentsDataRoot: string,
  agentId: string,
  options: { createFiles?: boolean } = {}
): Promise<string> {
  const agentDataPath = agentDataDirectoryPath(agentsDataRoot, agentId)
  await ensureAgentStorageDirectory(agentsDataRoot, agentDataPath)
  await ensureAgentStorageDirectory(agentsDataRoot, path.join(agentDataPath, 'memory'))

  if (options.createFiles !== false) {
    for (const filename of AGENT_DATA_FILES) {
      await ensureEmptyFile(path.join(agentDataPath, filename))
    }
  }

  await assertAgentDataDirectory(agentsDataRoot, agentId)
  return agentDataPath
}

export async function createAgentDataDirectory(agentsDataRoot: string, agentId: string): Promise<string> {
  const agentDataPath = agentDataDirectoryPath(agentsDataRoot, agentId)
  await ensureAgentStorageDirectory(agentsDataRoot, agentsDataRoot)
  await assertAgentStoragePath(agentsDataRoot, agentDataPath)
  if (await lstatIfExists(agentDataPath)) {
    throw new Error(`Agent data directory already exists: ${agentDataPath}`)
  }

  await mkdir(asAbsolutePath(agentDataPath))
  try {
    await ensureAgentDataDirectory(agentsDataRoot, agentId)
    return agentDataPath
  } catch (error) {
    await removeAgentDataDirectory(agentsDataRoot, agentId).catch(() => undefined)
    throw error
  }
}

export async function assertAgentDataDirectory(agentsDataRoot: string, agentId: string): Promise<string> {
  const agentDataPath = agentDataDirectoryPath(agentsDataRoot, agentId)
  await assertAgentStoragePath(agentsDataRoot, agentDataPath)

  const rootStat = await lstatIfExists(agentDataPath)
  if (!rootStat?.isDirectory || rootStat.isSymbolicLink) {
    throw new Error(`Agent data directory must be a real directory: ${agentDataPath}`)
  }

  const memoryPath = path.join(agentDataPath, 'memory')
  const memoryStat = await lstatIfExists(memoryPath)
  if (!memoryStat?.isDirectory || memoryStat.isSymbolicLink) {
    throw new Error(`Agent memory directory must be a real directory: ${memoryPath}`)
  }

  for (const filename of AGENT_DATA_FILES) {
    const filePath = path.join(agentDataPath, filename)
    const fileStat = await lstatIfExists(filePath)
    if (fileStat && (!fileStat.isFile || fileStat.isSymbolicLink)) {
      throw new Error(`Agent data file must be a real file: ${filePath}`)
    }
  }
  return agentDataPath
}

export async function removeAgentDataDirectory(agentsDataRoot: string, agentId: string): Promise<void> {
  const agentDataPath = agentDataDirectoryPath(agentsDataRoot, agentId)
  await assertAgentStoragePath(agentsDataRoot, agentDataPath)
  const targetStat = await lstatIfExists(agentDataPath)
  if (!targetStat) return
  if (!targetStat.isDirectory || targetStat.isSymbolicLink) {
    throw new Error(`Refusing to recursively remove unsafe agent data path: ${agentDataPath}`)
  }
  await removeDir(asAbsolutePath(agentDataPath))
}
