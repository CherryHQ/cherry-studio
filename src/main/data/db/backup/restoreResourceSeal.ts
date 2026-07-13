import fs from 'node:fs'
import path from 'node:path'

/** Narrow synchronous filesystem surface needed to test restore resource durability ordering. */
export interface RestoreResourceFileSystem {
  mkdirSync(path: string, options: { recursive: true }): string | undefined
  realpathSync(path: string): string
  openSync(path: string, flags: string): number
  copyFileSync(source: string, destination: string, mode: number): void
  writeFileSync(fd: number, contents: Buffer): void
  fsyncSync(fd: number): void
  closeSync(fd: number): void
  renameSync(oldPath: string, newPath: string): void
  rmSync(path: string, options: { force: true }): void
}

const nodeFileSystem: RestoreResourceFileSystem = fs

/**
 * Durably write one resource below a restore staging root. The temporary file is
 * a sibling so rename stays atomic on the same filesystem.
 */
export function sealRestoreResource(
  stagingRoot: string,
  destination: string,
  contents: Buffer,
  fileSystem: RestoreResourceFileSystem = nodeFileSystem
): void {
  sealRestoreResourceWithWriter(stagingRoot, destination, fileSystem, (temporary) => {
    const fd = fileSystem.openSync(temporary, 'wx')
    fileSystem.writeFileSync(fd, contents)
    return fd
  })
}

/** Durably copy one source file without materializing its contents in process memory. */
export function sealRestoreResourceFromPath(
  stagingRoot: string,
  destination: string,
  sourcePath: string,
  fileSystem: RestoreResourceFileSystem = nodeFileSystem
): void {
  sealRestoreResourceWithWriter(stagingRoot, destination, fileSystem, (temporary) => {
    fileSystem.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL)
    return fileSystem.openSync(temporary, 'r')
  })
}

/** Seal a temporary resource after its writer returns an open descriptor for fsync. */
function sealRestoreResourceWithWriter(
  stagingRoot: string,
  destination: string,
  fileSystem: RestoreResourceFileSystem,
  writeTemporary: (temporary: string) => number
): void {
  const root = path.resolve(stagingRoot)
  const target = path.resolve(destination)
  if (!isContained(root, target)) {
    throw new Error(`restore resource destination escapes staging root: ${destination}`)
  }

  const parent = path.dirname(target)
  fileSystem.mkdirSync(parent, { recursive: true })
  // Resolve the created parent after mkdir so a pre-existing symlink cannot route
  // the resource write outside the restore staging tree.
  const realRoot = fileSystem.realpathSync(root)
  const realParent = fileSystem.realpathSync(parent)
  if (!isContained(realRoot, realParent)) {
    throw new Error(`restore resource destination escapes staging root: ${destination}`)
  }
  const realTarget = path.join(realParent, path.basename(target))
  const temporary = `${realTarget}.tmp-${process.pid}-${Date.now()}`
  let fd: number | undefined
  try {
    fd = writeTemporary(temporary)
    fileSystem.fsyncSync(fd)
    fileSystem.closeSync(fd)
    fd = undefined
    fileSystem.renameSync(temporary, realTarget)
    fsyncDirectories(realRoot, realParent, fileSystem)
  } catch (error) {
    if (fd !== undefined) fileSystem.closeSync(fd)
    fileSystem.rmSync(temporary, { force: true })
    throw error
  }
}

/** Ensure a path stays below the supplied root, including the root itself. */
function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`)
}

/** Persist child-to-root directory entries after the resource rename on POSIX. */
function fsyncDirectories(root: string, leaf: string, fileSystem: RestoreResourceFileSystem): void {
  if (process.platform === 'win32') return
  let current = leaf
  while (true) {
    const fd = fileSystem.openSync(current, 'r')
    try {
      fileSystem.fsyncSync(fd)
    } finally {
      fileSystem.closeSync(fd)
    }
    if (current === root) return
    const parent = path.dirname(current)
    if (parent === current || !isContained(root, parent)) {
      throw new Error(`restore resource directory escapes staging root: ${current}`)
    }
    current = parent
  }
}
