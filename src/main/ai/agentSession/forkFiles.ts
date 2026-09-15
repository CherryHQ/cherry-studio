import { createHash } from 'node:crypto'
import { type BigIntStats, constants } from 'node:fs'
import { copyFile, link, lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { AgentSessionForkError } from '../runtime/forkCheckpoint'

export async function readNativeForkHistory<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new AgentSessionForkError('history_missing')
    if (error instanceof SyntaxError) throw new AgentSessionForkError('history_corrupt')
    throw error
  }
}

function identity(stat: BigIntStats) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}

export async function forkFileIdentity(file: string): Promise<string> {
  const stat = await lstat(file, { bigint: true })
  if (stat.isSymbolicLink()) throw new AgentSessionForkError('workspace_unsupported_file')
  return [stat.dev, stat.ino].join(':')
}

/** Publish exclusively, including when an external Claude config lives on another volume. */
export async function publishForkArtifact(
  source: string,
  target: string,
  signal: AbortSignal,
  created: (identity: string) => void
): Promise<void> {
  signal.throwIfAborted()
  try {
    await link(source, target)
    created(await forkFileIdentity(target))
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }
  const output = await open(target, 'wx', 0o600)
  try {
    const stat = await output.stat({ bigint: true })
    // Persist identity before writing bytes. An interrupted copy can be safely removed.
    created([stat.dev, stat.ino].join(':'))
    const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const buffer = Buffer.alloc(1024 * 1024)
      for (;;) {
        signal.throwIfAborted()
        const { bytesRead } = await input.read(buffer)
        if (!bytesRead) break
        let offset = 0
        while (offset < bytesRead) {
          const written = await output.write(buffer, offset, bytesRead - offset)
          if (!written.bytesWritten) throw new Error('Fork artifact write made no progress')
          offset += written.bytesWritten
        }
      }
      await output.sync()
    } finally {
      await input.close()
    }
  } finally {
    await output.close()
  }
  if ((await fileHash(source, signal)) !== (await fileHash(target, signal)))
    throw new Error('Fork artifact copy failed validation')
}
async function fileHash(file: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      signal.throwIfAborted()
      hash.update(chunk)
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

interface FileVersion {
  identity: string
  hash?: string
  directory: boolean
}

async function scan(root: string, signal: AbortSignal): Promise<Map<string, FileVersion>> {
  const result = new Map<string, FileVersion>()
  const walk = async (relative: string): Promise<void> => {
    signal.throwIfAborted()
    const file = path.join(root, relative)
    const before = await lstat(file, { bigint: true })
    if (before.isSymbolicLink() || (!before.isFile() && !before.isDirectory())) {
      throw new AgentSessionForkError('workspace_unsupported_file')
    }
    const canonical = await realpath(file)
    const normalize = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value)
    if (normalize(canonical) !== normalize(path.resolve(file)))
      throw new AgentSessionForkError('workspace_unsupported_file')
    const version: FileVersion = { identity: identity(before), directory: before.isDirectory() }
    if (before.isFile()) version.hash = await fileHash(file, signal)
    if (identity(await lstat(file, { bigint: true })) !== version.identity)
      throw new AgentSessionForkError('workspace_changed')
    result.set(relative, version)
    if (before.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await walk(path.join(relative, name))
    }
  }
  await walk('')
  return result
}

/** Detect changes over the complete copy window; this is not an atomic filesystem snapshot. */
export async function copyForkWorkspace(
  source: string,
  target: string,
  signal: AbortSignal,
  created?: (identity: string) => void
): Promise<void> {
  const before = await scan(source, signal)
  await mkdir(target, { recursive: false })
  created?.(await forkFileIdentity(target))
  for (const [relative, version] of before) {
    signal.throwIfAborted()
    if (!relative) continue
    const from = path.join(source, relative)
    const to = path.join(target, relative)
    if (version.directory) {
      await mkdir(to, { recursive: false })
    } else {
      if (identity(await lstat(from, { bigint: true })) !== version.identity)
        throw new AgentSessionForkError('workspace_changed')
      await copyFile(from, to, constants.COPYFILE_EXCL)
      if (
        identity(await lstat(from, { bigint: true })) !== version.identity ||
        (await fileHash(to, signal)) !== version.hash
      ) {
        throw new AgentSessionForkError('workspace_changed')
      }
    }
  }
  const after = await scan(source, signal)
  if (
    before.size !== after.size ||
    [...before].some(([name, version]) => JSON.stringify(version) !== JSON.stringify(after.get(name)))
  ) {
    throw new AgentSessionForkError('workspace_changed')
  }
}

/** Read only a committed prefix. Later appends are allowed; truncation/replacement is not. */
export async function readForkPrefix(file: string, bytes?: number): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    const length = bytes ?? before.size
    if (!before.isFile() || length > before.size || length > 512 * 1024 * 1024) {
      throw new AgentSessionForkError('history_corrupt')
    }
    const result = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = await handle.read(result, offset, length - offset, offset)
      if (!read.bytesRead) throw new AgentSessionForkError('history_changed')
      offset += read.bytesRead
    }
    const after = await lstat(file)
    if (after.isSymbolicLink() || before.ino !== after.ino || before.dev !== after.dev || after.size < length) {
      throw new AgentSessionForkError('history_changed')
    }
    return bytes === undefined ? result.subarray(0, result.lastIndexOf(10) + 1) : result
  } finally {
    await handle.close()
  }
}
