import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { isWin } from '@main/core/platform'
import { type MemoryFacts, type MemoryJournalEntry, MemoryJournalEntrySchema } from '@shared/ai/agentMemory'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { MEMORY_CONFLICT } from '@shared/ipc/errors/memory'

const logger = loggerService.withContext('MemoryFiles')
const writes = new KeyedMutex()

export interface MemoryFiles {
  directory: () => Promise<string>
  facts: string
  journal: string
}

function noFollow(flags: number): number {
  return isWin ? flags : flags | constants.O_NOFOLLOW | constants.O_NONBLOCK
}

async function assertFile(file: string): Promise<void> {
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Memory must be a regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function resolveMemoryFile(directory: string, name: string): Promise<string> {
  const entries = await readdir(directory)
  const file = path.join(
    directory,
    entries.find((entry) => entry === name) ??
      entries.find((entry) => entry.toLowerCase() === name.toLowerCase()) ??
      name
  )
  await assertFile(file)
  return file
}

async function readFile(file: string): Promise<{ content: string; modifiedAt: string } | undefined> {
  try {
    const handle = await open(file, noFollow(constants.O_RDONLY))
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error('Memory must be a regular file')
      return { content: await handle.readFile('utf8'), modifiedAt: new Date(stat.mtimeMs).toISOString() }
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function snapshot(content: string, modifiedAt?: string): MemoryFacts {
  return {
    content,
    revision: createHash('sha256').update(content).digest('hex'),
    ...(modifiedAt ? { modifiedAt } : {})
  }
}

export async function readMemoryFacts(files: MemoryFiles): Promise<MemoryFacts> {
  const file = await readFile(await resolveMemoryFile(await files.directory(), files.facts))
  return snapshot(file?.content ?? '', file?.modifiedAt)
}

export async function updateMemoryFacts(
  files: MemoryFiles,
  content: string,
  expectedRevision?: string
): Promise<MemoryFacts> {
  const directory = await files.directory()
  return writes.runExclusive(directory, async () => {
    const file = await resolveMemoryFile(await files.directory(), files.facts)
    if (
      expectedRevision !== undefined &&
      snapshot((await readFile(file))?.content ?? '').revision !== expectedRevision
    ) {
      throw new IpcError(MEMORY_CONFLICT, 'MEMORY_CONFLICT: Memory changed. Read the latest facts before saving again.')
    }
    const temporary = path.join(directory, `.${files.facts}.${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      const stat = await handle.stat()
      await handle.close()
      await files.directory()
      await assertFile(file)
      await rename(temporary, file)
      return snapshot(content, new Date(stat.mtimeMs).toISOString())
    } catch (error) {
      await handle.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  })
}

export async function appendMemoryJournal(files: MemoryFiles, text: string, tags: string[]) {
  const directory = await files.directory()
  return writes.runExclusive(directory, async () => {
    const file = await resolveMemoryFile(await files.directory(), files.journal)
    const entry = { ts: new Date().toISOString(), tags, text }
    const handle = await open(file, noFollow(constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY), 0o600)
    try {
      if (!(await handle.stat()).isFile()) throw new Error('Memory journal must be a regular file')
      await handle.appendFile(`${JSON.stringify(entry)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    return entry
  })
}

export async function searchMemoryJournal(files: MemoryFiles, query = '', tag = '', limit = 20) {
  const file = await resolveMemoryFile(await files.directory(), files.journal)
  const content = (await readFile(file))?.content
  if (content === undefined) return undefined
  const matches: MemoryJournalEntry[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = MemoryJournalEntrySchema.parse(JSON.parse(line))
      if (query && !entry.text.toLowerCase().includes(query.toLowerCase())) continue
      if (tag && !entry.tags.some((value) => value.toLowerCase() === tag.toLowerCase())) continue
      matches.push(entry)
    } catch {
      logger.warn('Skipping malformed memory journal record')
    }
  }
  return matches.slice(-limit).reverse()
}
