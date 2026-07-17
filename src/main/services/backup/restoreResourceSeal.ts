// Durable seal for restore-staged file resources (staging spec rule10).
//
// Export FileStager's ordinary copy is NOT sufficient for journal durability.
// Every sealed blob/dir entry must: write a temporary sibling → fsync the file →
// atomic rename onto the target → fsync directories from the leaf upward to the
// restore work root. Windows directory fsync follows the journal best-effort
// pattern (EINVAL/EISDIR/ENOTSUP silenced).

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { shouldSilenceFsyncDirError } from '@main/utils/file'

const logger = loggerService.withContext('backup/restoreResourceSeal')

/** Narrow FS surface so unit tests can assert seal ordering without power-loss simulation. */
export interface ResourceSealFs {
  readonly copyFileSync: (src: string, dest: string) => void
  readonly renameSync: (src: string, dest: string) => void
  readonly openSync: (p: string, flags: string) => number
  readonly fsyncSync: (fd: number) => void
  readonly closeSync: (fd: number) => void
  readonly mkdirSync: (p: string, opts?: { recursive?: boolean }) => void
  readonly readdirSync: (p: string, opts: { withFileTypes: true }) => fs.Dirent[]
  readonly unlinkSync: (p: string) => void
  readonly rmSync: (p: string, opts?: { recursive?: boolean; force?: boolean }) => void
  readonly existsSync: (p: string) => boolean
}

const defaultFs: ResourceSealFs = {
  copyFileSync: fs.copyFileSync,
  renameSync: fs.renameSync,
  openSync: fs.openSync,
  fsyncSync: fs.fsyncSync,
  closeSync: fs.closeSync,
  mkdirSync: (p, opts) => {
    fs.mkdirSync(p, opts)
  },
  readdirSync: (p, opts) => fs.readdirSync(p, opts),
  unlinkSync: fs.unlinkSync,
  rmSync: (p, opts) => {
    fs.rmSync(p, opts)
  },
  existsSync: fs.existsSync
}

export interface SealFileOptions {
  /** Absolute restore work root — directory fsync walks stop here (inclusive). */
  readonly stopDir: string
  readonly fs?: ResourceSealFs
}

/**
 * Seal one file into `targetPath` (may equal `sourcePath` for in-place seal).
 * Sequence: tmp copy → file fsync → atomic rename → leaf-up directory fsync.
 */
export function sealFileResource(sourcePath: string, targetPath: string, options: SealFileOptions): void {
  const vfs = options.fs ?? defaultFs
  const dir = path.dirname(targetPath)
  vfs.mkdirSync(dir, { recursive: true })

  const tmpPath = `${targetPath}.seal-tmp`
  try {
    vfs.copyFileSync(sourcePath, tmpPath)
    const fd = vfs.openSync(tmpPath, 'r+')
    try {
      vfs.fsyncSync(fd)
    } finally {
      vfs.closeSync(fd)
    }
    vfs.renameSync(tmpPath, targetPath)
  } catch (error) {
    try {
      if (vfs.existsSync(tmpPath)) vfs.unlinkSync(tmpPath)
    } catch {
      // best-effort tmp cleanup
    }
    throw error
  }

  fsyncAncestors(targetPath, options.stopDir, vfs)
}

/**
 * Seal a directory tree: every regular file is sealed under the same relative
 * layout beneath `targetDir`. Empty directories are created but not file-sealed.
 */
export function sealDirectoryResource(sourceDir: string, targetDir: string, options: SealFileOptions): void {
  const vfs = options.fs ?? defaultFs
  vfs.mkdirSync(targetDir, { recursive: true })
  sealDirectoryRecursive(sourceDir, targetDir, options.stopDir, vfs)
  fsyncAncestors(targetDir, options.stopDir, vfs)
}

function sealDirectoryRecursive(sourceDir: string, targetDir: string, stopDir: string, vfs: ResourceSealFs): void {
  for (const entry of vfs.readdirSync(sourceDir, { withFileTypes: true })) {
    const src = path.join(sourceDir, entry.name)
    const dest = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      vfs.mkdirSync(dest, { recursive: true })
      sealDirectoryRecursive(src, dest, stopDir, vfs)
      fsyncAncestors(dest, stopDir, vfs)
      continue
    }
    if (entry.isFile()) {
      sealFileResource(src, dest, { stopDir, fs: vfs })
    }
  }
}

/**
 * fsync the directory containing `leafPath`, then each ancestor up to and
 * including `stopDir`. No-op ancestors above stopDir. Windows/unsupported FS
 * dir-fsync errors are silenced the same way as journal durability.
 */
export function fsyncAncestors(leafPath: string, stopDir: string, vfs: ResourceSealFs = defaultFs): void {
  if (process.platform === 'win32') return

  const stop = path.resolve(stopDir)
  let current = path.resolve(path.dirname(leafPath))

  for (;;) {
    try {
      const fd = vfs.openSync(current, 'r')
      try {
        vfs.fsyncSync(fd)
      } finally {
        vfs.closeSync(fd)
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (!shouldSilenceFsyncDirError(code)) {
        logger.warn('restore resource seal: directory fsync failed', { dir: current, code, err })
      }
    }

    if (current === stop) break
    const parent = path.dirname(current)
    if (parent === current) break
    // Refuse to walk above stopDir even if path math drifts.
    if (!current.startsWith(stop + path.sep) && current !== stop) break
    current = parent
  }
}
