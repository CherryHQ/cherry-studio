import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

export const MEMORY_ENTRY = 'MEMORY.md'
export const MEMORY_TOPICS = '.memories'
export const MEMORY_MAX_BYTES = 25_000
export const MEMORY_MAX_LINES = 200
export const MEMORY_WARNING_BYTES = 20_000
export const MEMORY_WARNING_LINES = 160
const COMPLETE_READ_BYTES = 20 * 1024 * 1024

export class MemoryError extends Error {
  constructor(
    readonly code: 'invalid-path' | 'conflict' | 'limit' | 'invalid-receipt' | 'backup-capacity' | 'invalid-backup',
    message: string
  ) {
    super(message)
    this.name = 'MemoryError'
  }
}

export function memoryHash(bytes: Uint8Array | null): string | null {
  return bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
}

export function assertMemoryTarget(relative: string): void {
  if (relative === MEMORY_ENTRY) return
  const parts = relative.split('/')
  const name = parts[1]
  if (
    parts.length !== 2 ||
    parts[0] !== MEMORY_TOPICS ||
    !name ||
    name.startsWith('.') ||
    !name.endsWith('.md') ||
    /[\\<>:"|?*]/.test(name) ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
  ) {
    throw new MemoryError('invalid-path', 'The target is not a managed memory file')
  }
}

export function memoryLineCount(content: string): number {
  if (!content) return 0
  const lines = content.split('\n').length
  return content.endsWith('\n') ? lines - 1 : lines
}

export function assertMemoryContent(relative: string, content: string): void {
  if (
    Buffer.byteLength(content, 'utf8') > MEMORY_MAX_BYTES ||
    (relative === MEMORY_ENTRY && memoryLineCount(content) > MEMORY_MAX_LINES)
  ) {
    throw new MemoryError('limit', 'Memory content exceeds the entry or topic limit')
  }
}

export function memoryEntryPreview(content: string): { content: string; truncated: boolean } {
  let bytes = 0
  const completeLines: string[] = []
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const size = Buffer.byteLength(line, 'utf8')
    if (completeLines.length === MEMORY_MAX_LINES || bytes + size > MEMORY_MAX_BYTES) break
    completeLines.push(line)
    bytes += size
  }
  const preview = completeLines.join('')
  return { content: preview, truncated: preview !== content }
}

export async function statIfPresent(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Validate each component without following links, including absent creation targets. */
export async function assertMemoryPath(root: string, relative: string): Promise<string> {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, relative)
  const fromRoot = path.relative(resolvedRoot, target)
  if (path.isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`)) {
    throw new MemoryError('invalid-path', 'Memory path escapes its scope')
  }
  let current = resolvedRoot
  const rootStat = await statIfPresent(current)
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new MemoryError('invalid-path', 'Memory root must be a real directory')
  }
  const canonicalRoot = await realpath(resolvedRoot)
  for (const segment of fromRoot ? fromRoot.split(path.sep) : []) {
    current = path.join(current, segment)
    const stat = await statIfPresent(current)
    if (!stat) break
    if (stat.isSymbolicLink() || (current !== target && !stat.isDirectory())) {
      throw new MemoryError('invalid-path', 'Memory paths must not contain links or non-directory parents')
    }
    const actual = path.relative(canonicalRoot, await realpath(current))
    if (path.isAbsolute(actual) || actual === '..' || actual.startsWith(`..${path.sep}`)) {
      throw new MemoryError('invalid-path', 'Memory path resolves outside its scope')
    }
  }
  return target
}

export async function readMemoryBytes(root: string, relative: string): Promise<Buffer | null> {
  const target = await assertMemoryPath(root, relative)
  const stat = await statIfPresent(target)
  if (!stat) return null
  if (!stat.isFile()) throw new MemoryError('invalid-path', 'Memory target must be a regular file')
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW)
  const handle = await open(target, flags)
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new MemoryError('invalid-path', 'Memory target must be a regular file')
    if (before.size > COMPLETE_READ_BYTES) {
      throw new MemoryError(
        'limit',
        'Memory file exceeds the complete-read budget; preserve and reorganize the original'
      )
    }
    const buffer = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length)
      if (result.bytesRead === 0) break
      length += result.bytesRead
    }
    const bytes = buffer.subarray(0, length)
    const after = await handle.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
      throw new MemoryError('conflict', 'Memory changed during the read')
    }
    await assertMemoryPath(root, relative)
    return bytes
  } finally {
    await handle.close()
  }
}

/** Entry injection has a bounded read and never produces an editing receipt. */
export async function readMemoryEntry(root: string): Promise<{ content: string; truncated: boolean }> {
  const target = await assertMemoryPath(root, MEMORY_ENTRY)
  const stat = await statIfPresent(target)
  if (!stat) return { content: '', truncated: false }
  if (!stat.isFile()) throw new MemoryError('invalid-path', 'Memory entry must be a regular file')
  const handle = await open(target, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW))
  try {
    const buffer = Buffer.alloc(MEMORY_MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length)
      if (result.bytesRead === 0) break
      length += result.bytesRead
    }
    const incomplete = length > MEMORY_MAX_BYTES
    let content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length), {
      stream: incomplete
    })
    if (incomplete) content = content.slice(0, content.lastIndexOf('\n') + 1)
    await assertMemoryPath(root, MEMORY_ENTRY)
    const preview = memoryEntryPreview(content)
    return { content: preview.content, truncated: incomplete || preview.truncated }
  } finally {
    await handle.close()
  }
}

export async function writeMemoryBytes(
  root: string,
  relative: string,
  bytes: Buffer | null,
  assertCurrent: () => void = () => undefined
): Promise<void> {
  const target = await assertMemoryPath(root, relative)
  if (bytes === null) {
    assertCurrent()
    await unlink(target)
    return
  }
  const temporary = `${relative}.${randomUUID()}.tmp`
  const temporaryPath = await assertMemoryPath(root, temporary)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await assertMemoryPath(root, relative)
    assertCurrent()
    await rename(temporaryPath, target)
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

export async function ensureMemoryDirectory(root: string, relative: string): Promise<void> {
  const target = await assertMemoryPath(root, relative)
  await mkdir(target, { recursive: true, mode: 0o700 })
  const stat = await statIfPresent(await assertMemoryPath(root, relative))
  if (!stat?.isDirectory()) throw new MemoryError('invalid-path', 'Memory directory is not a directory')
}

export async function listMemoryFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const entry = await statIfPresent(await assertMemoryPath(root, MEMORY_ENTRY))
  if (entry?.isFile()) files.push(MEMORY_ENTRY)
  const topics = await assertMemoryPath(root, MEMORY_TOPICS)
  const topicStat = await statIfPresent(topics)
  if (!topicStat) return files
  if (!topicStat.isDirectory()) throw new MemoryError('invalid-path', 'Memory topics must be a directory')
  for (const entry of await readdir(topics, { withFileTypes: true })) {
    const relative = `${MEMORY_TOPICS}/${entry.name}`
    try {
      assertMemoryTarget(relative)
    } catch {
      continue
    }
    await assertMemoryPath(root, relative)
    if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}
