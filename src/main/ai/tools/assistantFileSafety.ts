import { isUtf8 } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { constants, type FileHandle, link, lstat, open, stat } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { validatePath } from '@main/ai/mcp/servers/filesystem'
import type { FilePath } from '@shared/types/file'

const logger = loggerService.withContext('AssistantFileSafety')
const IO_CHUNK_BYTES = 64 * 1024
const CLEANUP_CHILD_MAX_BUFFER_BYTES = 4 * 1024
const CLEANUP_CHILD_TIMEOUT_MS = 2_000
const HARD_LINK_FALLBACK_CODES = new Set(['EACCES', 'EMLINK', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'])
const UNLINK_OWNED_PATH_SCRIPT = String.raw`
'use strict'
const fs = require('node:fs')
const [leafName, expectedParentDev, expectedParentIno, expectedFileDev, expectedFileIno] = process.argv.slice(1)
const invalidLeaf =
  !leafName ||
  leafName === '.' ||
  leafName === '..' ||
  leafName.includes(String.fromCharCode(0)) ||
  leafName.includes('/') ||
  leafName.includes(String.fromCharCode(92))

if (invalidLeaf) process.exit(64)

try {
  const parent = fs.lstatSync('.')
  if (
    !parent.isDirectory() ||
    String(parent.dev) !== expectedParentDev ||
    String(parent.ino) !== expectedParentIno
  ) {
    process.exit(65)
  }

  const target = fs.lstatSync(leafName)
  if (
    !target.isFile() ||
    String(target.dev) !== expectedFileDev ||
    String(target.ino) !== expectedFileIno
  ) {
    process.exit(66)
  }

  fs.unlinkSync(leafName)
} catch (error) {
  if (error && error.code === 'ENOENT') process.exit(0)
  process.stderr.write(String((error && error.code) || error).slice(0, 512))
  process.exit(1)
}
`

export function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code
}

export function relativeWorkspacePath(workspacePath: string, targetPath: string): string {
  return path.relative(workspacePath, targetPath).split(path.sep).join('/')
}

export async function assertWorkspacePathUnchanged(
  requestedPath: string,
  expectedPath: string,
  workspacePath: string,
  errorMessage: string
): Promise<void> {
  const currentPath = await validatePath(requestedPath, workspacePath)
  const resolvedCurrent = path.resolve(currentPath)
  const resolvedExpected = path.resolve(expectedPath)
  const equal =
    process.platform === 'win32'
      ? resolvedCurrent.toLowerCase() === resolvedExpected.toLowerCase()
      : resolvedCurrent === resolvedExpected
  if (!equal) throw new Error(`${errorMessage}: ${requestedPath}`)
}

/** Read a stable regular UTF-8 file without following a last-component symlink. */
export async function readBoundedRegularFile(
  target: FilePath,
  options: { maxBytes: number; signal?: AbortSignal }
): Promise<string> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer')
  }

  options.signal?.throwIfAborted()
  const initialPathStat = await lstat(target)
  if (!initialPathStat.isFile()) throw new Error(`Path is not a regular file: ${target}`)
  if (initialPathStat.size > options.maxBytes) {
    throw new Error(`File exceeds the ${options.maxBytes}-byte read limit: ${target}`)
  }

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const nonBlock = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0
  const handle = await open(target, constants.O_RDONLY | noFollow | nonBlock)

  try {
    const openedStat = await handle.stat()
    if (!openedStat.isFile()) throw new Error(`Path is not a regular file: ${target}`)
    if (!sameFileIdentity(openedStat, initialPathStat)) throw new Error(`Path changed while being opened: ${target}`)
    if (openedStat.size > options.maxBytes) {
      throw new Error(`File exceeds the ${options.maxBytes}-byte read limit: ${target}`)
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    for (;;) {
      options.signal?.throwIfAborted()
      const remainingWithOverflowByte = options.maxBytes - totalBytes + 1
      const buffer = Buffer.allocUnsafe(Math.min(IO_CHUNK_BYTES, remainingWithOverflowByte))
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null)
      if (bytesRead === 0) break

      totalBytes += bytesRead
      if (totalBytes > options.maxBytes) {
        throw new Error(`File exceeds the ${options.maxBytes}-byte read limit: ${target}`)
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }

    options.signal?.throwIfAborted()
    const finalOpenedStat = await handle.stat()
    if (!sameStableFile(openedStat, finalOpenedStat)) throw new Error(`File changed while being read: ${target}`)

    const finalPathStat = await lstat(target)
    if (!finalPathStat.isFile() || !sameStableFile(finalOpenedStat, finalPathStat)) {
      throw new Error(`Path changed while being read: ${target}`)
    }

    const data = Buffer.concat(chunks, totalBytes)
    if (!isUtf8(data)) throw new Error(`File is not valid UTF-8 text: ${target}`)
    const text = data.toString('utf8')
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } finally {
    await handle.close()
  }
}

interface PublishFileNoClobberOptions {
  signal?: AbortSignal
  validateTarget?: () => Promise<void>
}

function sameFileIdentity(left: Pick<Stats, 'dev' | 'ino'>, right: Pick<Stats, 'dev' | 'ino'>): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameStableFile(
  left: Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'ctimeMs'>,
  right: Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'ctimeMs'>
): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function shouldFallbackFromHardLink(error: unknown): boolean {
  return HARD_LINK_FALLBACK_CODES.has((error as NodeJS.ErrnoException).code ?? '')
}

function runUnlinkOwnedPathChild(
  parentPath: string,
  leafName: string,
  parent: Stats,
  file: Pick<Stats, 'dev' | 'ino'>
): Promise<void> {
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT
  }

  return new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      [
        '-e',
        UNLINK_OWNED_PATH_SCRIPT,
        '--',
        leafName,
        String(parent.dev),
        String(parent.ino),
        String(file.dev),
        String(file.ino)
      ],
      {
        cwd: parentPath,
        encoding: 'utf8',
        env,
        maxBuffer: CLEANUP_CHILD_MAX_BUFFER_BYTES,
        timeout: CLEANUP_CHILD_TIMEOUT_MS,
        windowsHide: true
      },
      (error, _stdout, stderr) => {
        if (!error) resolve()
        else reject(Object.assign(error, { stderr }))
      }
    )
  })
}

async function bestEffortUnlinkOwnedPath(
  target: FilePath,
  expected: Pick<Stats, 'dev' | 'ino'>,
  operation: string
): Promise<void> {
  const parentPath = path.dirname(target)
  const leafName = path.basename(target)
  if (
    !leafName ||
    leafName === '.' ||
    leafName === '..' ||
    leafName.includes('\0') ||
    leafName.includes('/') ||
    leafName.includes('\\')
  ) {
    logger.warn(`${operation}: refusing unsafe cleanup leaf name`, { target })
    return
  }

  try {
    const parentStat = await stat(parentPath)
    if (!parentStat.isDirectory()) throw new Error(`Cleanup parent is not a directory: ${parentPath}`)
    await runUnlinkOwnedPathChild(parentPath, leafName, parentStat, expected)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return
    const stderr = String((error as { stderr?: string | Buffer }).stderr ?? '').slice(0, CLEANUP_CHILD_MAX_BUFFER_BYTES)
    logger.warn(`${operation}: cleanup refused or failed; leaving path untouched`, {
      target,
      code: (error as NodeJS.ErrnoException).code,
      stderr,
      error
    })
  }
}

async function copyFileHandles(source: FileHandle, destination: FileHandle, signal?: AbortSignal): Promise<void> {
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES)
  let position = 0

  for (;;) {
    signal?.throwIfAborted()
    const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position)
    if (bytesRead === 0) break

    let chunkOffset = 0
    while (chunkOffset < bytesRead) {
      signal?.throwIfAborted()
      const { bytesWritten } = await destination.write(
        buffer,
        chunkOffset,
        bytesRead - chunkOffset,
        position + chunkOffset
      )
      if (bytesWritten === 0) throw new Error('Published target stopped accepting data')
      chunkOffset += bytesWritten
    }
    position += bytesRead
  }

  signal?.throwIfAborted()
  await destination.sync()
  signal?.throwIfAborted()
}

async function assertPathIdentity(target: FilePath, expected: Pick<Stats, 'dev' | 'ino'>): Promise<void> {
  const current = await lstat(target)
  if (!current.isFile() || !sameFileIdentity(current, expected)) {
    throw new Error(`Target path changed while being published: ${target}`)
  }
}

async function fsyncDirectoryOf(target: FilePath): Promise<void> {
  try {
    const directoryHandle = await open(path.dirname(target), 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EINVAL' || code === 'EISDIR' || code === 'ENOTSUP') return
    logger.warn('Failed to fsync Assistant artifact directory', { target, code, error })
  }
}

/** Publish a fully-written staging file at a new target without replacing an existing path. */
export async function publishFileNoClobber(
  staged: FilePath,
  target: FilePath,
  options: PublishFileNoClobberOptions = {}
): Promise<void> {
  options.signal?.throwIfAborted()
  const stagedPathStat = await lstat(staged)
  if (!stagedPathStat.isFile()) throw new Error(`Staged path is not a regular file: ${staged}`)

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const stagedHandle = await open(staged, constants.O_RDONLY | noFollow)
  let reservationHandle: FileHandle | undefined
  let reservationPath: FilePath | undefined
  let reservationStat: Stats | undefined
  let destinationHandle: FileHandle | undefined
  let destinationStat: Stats | undefined
  let targetReserved = false
  let committed = false

  try {
    const openedStagedStat = await stagedHandle.stat()
    if (!openedStagedStat.isFile() || !sameFileIdentity(openedStagedStat, stagedPathStat)) {
      throw new Error(`Staged path changed while being opened: ${staged}`)
    }

    reservationPath = `${staged}.publish-${randomUUID()}` as FilePath
    reservationHandle = await open(reservationPath, 'wx+', stagedPathStat.mode & 0o777)
    reservationStat = await reservationHandle.stat()

    options.signal?.throwIfAborted()
    try {
      await link(reservationPath, target)
      targetReserved = true
      destinationHandle = reservationHandle
      destinationStat = reservationStat
    } catch (error) {
      if (!shouldFallbackFromHardLink(error)) throw error
      options.signal?.throwIfAborted()
      destinationHandle = await open(target, 'wx+', stagedPathStat.mode & 0o777)
      targetReserved = true
      destinationStat = await destinationHandle.stat()
    }

    await assertPathIdentity(target, destinationStat)
    await options.validateTarget?.()
    await copyFileHandles(stagedHandle, destinationHandle, options.signal)
    await assertPathIdentity(target, destinationStat)
    await options.validateTarget?.()
    options.signal?.throwIfAborted()

    await stagedHandle.close()
    options.signal?.throwIfAborted()
    await destinationHandle.close()
    if (destinationHandle === reservationHandle) reservationHandle = undefined
    destinationHandle = undefined
    committed = true
  } finally {
    if (!committed && destinationHandle) {
      try {
        await destinationHandle.truncate(0)
        await destinationHandle.sync()
      } catch (error) {
        logger.warn('Failed to clear an uncommitted Assistant artifact', {
          target,
          code: (error as NodeJS.ErrnoException).code,
          error
        })
      }
    }
    await destinationHandle?.close().catch(() => undefined)
    if (reservationHandle !== destinationHandle) await reservationHandle?.close().catch(() => undefined)
    await stagedHandle.close().catch(() => undefined)

    if (!committed && targetReserved && destinationStat) {
      await bestEffortUnlinkOwnedPath(target, destinationStat, 'publishFileNoClobber')
    }
    if (reservationPath && reservationStat) {
      await bestEffortUnlinkOwnedPath(reservationPath, reservationStat, 'publishFileNoClobber')
    }
  }

  await bestEffortUnlinkOwnedPath(staged, stagedPathStat, 'publishFileNoClobber')
  await fsyncDirectoryOf(target)
}
