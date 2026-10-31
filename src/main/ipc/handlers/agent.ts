import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { shell } from 'electron'

import { application } from '@application'
import {
  agentDataDirectoryPath,
  assertAgentStorageDirectory,
  assertAgentStoragePath,
  ensureAgentStorageDirectory
} from '@main/ai/agents/agentDataDirectory'
import { withAgentMemoryFileLock } from '@main/ai/agents/agentMemoryFileLock'
import type { AgentMemoryFile, agentRequestSchemas } from '@shared/ipc/schemas/agent'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Files the memory viewer can show. Paths are fixed here — never supplied by the renderer. */
const MEMORY_FILES = [
  { key: 'soul', name: 'SOUL.md', segments: ['SOUL.md'], tailWhenLarge: false },
  { key: 'user', name: 'USER.md', segments: ['USER.md'], tailWhenLarge: false },
  { key: 'fact', name: 'FACT.md', segments: ['memory', 'FACT.md'], tailWhenLarge: false },
  { key: 'journal', name: 'JOURNAL.jsonl', segments: ['memory', 'JOURNAL.jsonl'], tailWhenLarge: true }
] as const satisfies ReadonlyArray<{
  key: AgentMemoryFile['key']
  name: string
  segments: readonly string[]
  tailWhenLarge: boolean
}>

/** One file is enough for a viewer; larger journals return their most recent slice. */
const MAX_FILE_BYTES = 1024 * 1024

/** Stable markers the renderer can recognise without depending on localized messages. */
export const AGENT_MEMORY_CONFLICT = 'AGENT_MEMORY_CONFLICT'
export const AGENT_MEMORY_TOO_LARGE = 'AGENT_MEMORY_TOO_LARGE'
export const AGENT_MEMORY_READ_ONLY = 'AGENT_MEMORY_READ_ONLY'

type FileStats = Stats

function revisionOf(stats: FileStats | undefined): string {
  return stats ? `${stats.size}:${stats.mtimeMs}` : 'missing'
}

async function lstatIfExists(targetPath: string): Promise<FileStats | undefined> {
  return lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
}

/**
 * Resolve a memory file name the same way the runtime does: prefer the exact name,
 * then fall back to a case-insensitive match. On case-sensitive filesystems the
 * runtime reads `fact.md` even when the catalog says `FACT.md`; creating a second
 * file here would shadow the real memory.
 */
async function resolveMemoryPath(dir: string, name: string): Promise<string> {
  const exact = path.join(dir, name)
  const exactStats = await lstatIfExists(exact)
  if (exactStats) {
    if (!exactStats.isFile() || exactStats.isSymbolicLink()) {
      throw new Error(`Agent memory file must be a real file: ${exact}`)
    }
    return exact
  }

  try {
    const entries = await readdir(dir)
    const match = entries.find((entry) => entry.toLowerCase() === name.toLowerCase())
    if (!match) return exact
    const matchedPath = path.join(dir, match)
    const matchedStats = await lstat(matchedPath)
    if (!matchedStats.isFile() || matchedStats.isSymbolicLink()) {
      throw new Error(`Agent memory file must be a real file: ${matchedPath}`)
    }
    return matchedPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return exact
  }
}

async function resolveAgentDirectory(agentId: string): Promise<{ root: string; directory: string }> {
  const root = application.getPath('feature.agents.data')
  const directory = agentDataDirectoryPath(root, agentId)
  try {
    await assertAgentStorageDirectory(root, directory)
  } catch (error) {
    // A missing directory is a valid "nothing remembered yet" state: report every
    // file as missing instead of failing the whole snapshot.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { root, directory }
}

function fileDir(directory: string, file: (typeof MEMORY_FILES)[number]): string {
  return path.join(directory, ...file.segments.slice(0, -1))
}

function fileName(file: (typeof MEMORY_FILES)[number]): string {
  return file.segments[file.segments.length - 1]
}

async function readMemoryFile(
  root: string,
  directory: string,
  file: (typeof MEMORY_FILES)[number]
): Promise<AgentMemoryFile> {
  const filePath = await resolveMemoryPath(fileDir(directory, file), fileName(file))
  await assertAgentStoragePath(root, filePath)

  const stats = await lstatIfExists(filePath)
  if (!stats) {
    return {
      key: file.key,
      name: file.name,
      path: filePath,
      exists: false,
      size: 0,
      updatedAt: null,
      version: 'missing',
      content: '',
      truncated: false
    }
  }

  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Agent memory file must be a real file: ${filePath}`)
  }

  const length = Math.min(stats.size, MAX_FILE_BYTES)
  const start = file.tailWhenLarge ? stats.size - length : 0
  const buffer = Buffer.alloc(length)
  const handle = await open(filePath, 'r')
  try {
    await handle.read(buffer, 0, length, start)
  } finally {
    await handle.close()
  }

  let content = buffer.toString('utf8')
  if (start > 0) {
    // Drop the partial first line (and any split UTF-8 lead byte) of a tail read.
    // Only when that newline is near the start: a large single-line file has its
    // only newline at the end, and discarding through it would return nothing.
    const firstNewline = content.indexOf('\n')
    if (firstNewline >= 0 && firstNewline < 4096) content = content.slice(firstNewline + 1)
  }

  return {
    key: file.key,
    name: file.name,
    path: filePath,
    exists: true,
    size: stats.size,
    updatedAt: stats.mtime.toISOString(),
    version: revisionOf(stats),
    content,
    truncated: stats.size > MAX_FILE_BYTES
  }
}

async function writeMemoryFile(
  root: string,
  directory: string,
  file: (typeof MEMORY_FILES)[number],
  content: string,
  expectedVersion: string
): Promise<AgentMemoryFile> {
  // The journal is append-only and written concurrently by the running agent.
  // Replacing it from the editor would silently drop entries.
  if (file.key === 'journal') throw new Error(AGENT_MEMORY_READ_ONLY)
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error(AGENT_MEMORY_TOO_LARGE)

  await ensureAgentStorageDirectory(root, directory)
  if (file.segments.length > 1) {
    await ensureAgentStorageDirectory(root, path.join(directory, 'memory'))
  }

  const filePath = await resolveMemoryPath(fileDir(directory, file), fileName(file))
  await assertAgentStoragePath(root, filePath)

  return withAgentMemoryFileLock(filePath, async () => {
    const existing = await lstatIfExists(filePath)
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
      throw new Error(`Agent memory file must be a real file: ${filePath}`)
    }
    if (existing && existing.size > MAX_FILE_BYTES) throw new Error(AGENT_MEMORY_TOO_LARGE)
    if (revisionOf(existing) !== expectedVersion) throw new Error(AGENT_MEMORY_CONFLICT)

    // Write beside the target, then replace it. The lock serializes every writer
    // in this process; the second revision check still guards the runtime tool,
    // which takes the same lock.
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
    try {
      await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      if (revisionOf(await lstatIfExists(filePath)) !== expectedVersion) throw new Error(AGENT_MEMORY_CONFLICT)
      await rename(tempPath, filePath)
    } finally {
      await rm(tempPath, { force: true })
    }

    return readMemoryFile(root, directory, file)
  })
}

export const agentHandlers: IpcHandlersFor<typeof agentRequestSchemas> = {
  'agent.memory.read': async ({ agentId }) => {
    const { root, directory } = await resolveAgentDirectory(agentId)
    const files = await Promise.all(MEMORY_FILES.map((file) => readMemoryFile(root, directory, file)))
    return { directory, files }
  },
  'agent.memory.write': async ({ agentId, key, content, expectedVersion }) => {
    const file = MEMORY_FILES.find((candidate) => candidate.key === key)
    if (!file) throw new Error(`Unknown agent memory file: ${key}`)
    const { root, directory } = await resolveAgentDirectory(agentId)
    return writeMemoryFile(root, directory, file, content, expectedVersion)
  },
  'agent.memory.open_folder': async ({ agentId }) => {
    const { directory } = await resolveAgentDirectory(agentId)
    const errorMessage = await shell.openPath(directory)
    if (errorMessage) throw new Error(`Failed to open agent memory folder: ${errorMessage}`)
  }
}
