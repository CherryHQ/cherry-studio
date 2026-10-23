// A folder on the user's computer, from `showDirectoryPicker()`, as a ZenFS file system. Every call
// runs on the directory handle when it is made, so files changed by other programs are current and
// nothing is read that is not asked for. The agent's file tools and approvals only use async calls.
import { constants, type CreationOptions, FileSystem, Inode, type InodeLike, isDirectory } from '@zenfs/core'
import { type Exception, withErrno } from 'kerium'

const ERRNO_BY_DOM_ERROR: Record<string, Parameters<typeof withErrno>[0]> = {
  NotFoundError: 'ENOENT',
  TypeMismatchError: 'ENOTDIR',
  InvalidModificationError: 'ENOTEMPTY',
  NotAllowedError: 'EACCES',
  SecurityError: 'EACCES',
  NoModificationAllowedError: 'EBUSY',
  QuotaExceededError: 'ENOSPC',
  NotSupportedError: 'ENOTSUP'
}

function toException(error: unknown, path: string): Exception {
  if (error instanceof Error && 'errno' in error) return error as Exception
  const name = error instanceof DOMException ? error.name : ''
  return withErrno(ERRNO_BY_DOM_ERROR[name] ?? 'EIO', `${(error as Error)?.message ?? error}: ${path}`)
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

function notSupported(): never {
  throw withErrno('ENOTSUP', 'A local folder supports only asynchronous file calls')
}

export class LocalFolderFS extends FileSystem {
  // ZenFS keys open files by inode number, so each path keeps one for as long as the mount lives.
  private readonly inodes = new Map<string, number>()
  private nextIno = 1

  constructor(readonly root: FileSystemDirectoryHandle) {
    super(0x6c6f6366, 'localfolder')
  }

  private ino(path: string): number {
    let ino = this.inodes.get(path)
    if (ino === undefined) this.inodes.set(path, (ino = this.nextIno++))
    return ino
  }

  private async run<T>(path: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      throw toException(error, path)
    }
  }

  private async directory(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let handle = this.root
    for (const name of segments(path)) handle = await handle.getDirectoryHandle(name, { create })
    return handle
  }

  private async parentOf(path: string): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const parts = segments(path)
    const name = parts.pop()
    if (!name) throw withErrno('EPERM', 'The folder itself cannot be changed')
    return { parent: await this.directory(parts.join('/')), name }
  }

  private async entry(path: string): Promise<FileSystemHandle> {
    if (!segments(path).length) return this.root
    const { parent, name } = await this.parentOf(path)
    try {
      return await parent.getFileHandle(name)
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'TypeMismatchError') throw error
      return await parent.getDirectoryHandle(name)
    }
  }

  private async file(path: string): Promise<FileSystemFileHandle> {
    const { parent, name } = await this.parentOf(path)
    return await parent.getFileHandle(name)
  }

  private async inode(path: string, handle: FileSystemHandle): Promise<Inode> {
    const ino = this.ino(path)
    if (handle.kind === 'directory') return new Inode({ ino, data: ino, mode: constants.S_IFDIR | 0o777, nlink: 1 })
    const { size, lastModified } = await (handle as FileSystemFileHandle).getFile()
    return new Inode({
      ino,
      data: ino,
      mode: constants.S_IFREG | 0o666,
      size,
      nlink: 1,
      mtimeMs: lastModified,
      ctimeMs: lastModified,
      atimeMs: lastModified
    })
  }

  async stat(path: string): Promise<InodeLike> {
    return this.run(path, async () => this.inode(path, await this.entry(path)))
  }

  async readdir(path: string): Promise<string[]> {
    return this.run(path, async () => {
      const names: string[] = []
      for await (const name of (await this.directory(path)).keys()) names.push(name)
      return names
    })
  }

  async read(path: string, buffer: Uint8Array, start: number, end: number): Promise<void> {
    await this.run(path, async () => {
      const file = await (await this.file(path)).getFile()
      buffer.set(new Uint8Array(await file.slice(start, end).arrayBuffer()))
    })
  }

  async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
    await this.run(path, async () => {
      const writable = await (await this.file(path)).createWritable({ keepExistingData: true })
      await writable.write({ type: 'write', position: offset, data: buffer.slice() })
      await writable.close()
    })
  }

  /** Only the size can change: a folder keeps no owner, mode or times of its own. */
  async touch(path: string, metadata: Partial<InodeLike>): Promise<void> {
    if (typeof metadata.size !== 'number') return
    const size = metadata.size
    await this.run(path, async () => {
      const handle = await this.file(path)
      if ((await handle.getFile()).size === size) return
      const writable = await handle.createWritable({ keepExistingData: true })
      await writable.truncate(size)
      await writable.close()
    })
  }

  async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
    if (isDirectory(options)) return this.mkdir(path)
    return this.run(path, async () => {
      const { parent, name } = await this.parentOf(path)
      return this.inode(path, await parent.getFileHandle(name, { create: true }))
    })
  }

  async mkdir(path: string): Promise<InodeLike> {
    return this.run(path, async () => {
      const { parent, name } = await this.parentOf(path)
      return this.inode(path, await parent.getDirectoryHandle(name, { create: true }))
    })
  }

  async unlink(path: string): Promise<void> {
    await this.remove(path)
  }

  async rmdir(path: string): Promise<void> {
    await this.remove(path)
  }

  private async remove(path: string): Promise<void> {
    await this.run(path, async () => {
      const { parent, name } = await this.parentOf(path)
      await parent.removeEntry(name)
      this.inodes.delete(path)
    })
  }

  /** Files are copied when the browser cannot move them; folders need `move`, which Chromium has. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.run(oldPath, async () => {
      const source = await this.entry(oldPath)
      const origin = await this.parentOf(oldPath)
      const target = await this.parentOf(newPath)
      const movable = source as FileSystemHandle & {
        move?: (parent: FileSystemDirectoryHandle, name: string) => Promise<void>
      }
      if (movable.move) {
        await movable.move(target.parent, target.name)
      } else if (source.kind === 'file') {
        const copy = await target.parent.getFileHandle(target.name, { create: true })
        const writable = await copy.createWritable()
        await writable.write(await (source as FileSystemFileHandle).getFile())
        await writable.close()
        await origin.parent.removeEntry(origin.name)
      } else {
        throw withErrno('ENOTSUP', 'This browser cannot move folders')
      }
      const ino = this.inodes.get(oldPath)
      this.inodes.delete(oldPath)
      if (ino !== undefined) this.inodes.set(newPath, ino)
    })
  }

  async link(): Promise<void> {
    throw withErrno('ENOTSUP', 'A local folder has no hard links')
  }

  async sync(): Promise<void> {}

  renameSync = notSupported
  statSync = notSupported
  touchSync = notSupported
  createFileSync = notSupported
  unlinkSync = notSupported
  rmdirSync = notSupported
  mkdirSync = notSupported
  readdirSync = notSupported
  linkSync = notSupported
  syncSync = notSupported
  readSync = notSupported
  writeSync = notSupported
}

/**
 * A stored folder whose permission the browser has not granted in this visit. Every call fails, so
 * nothing lands in the root file system instead, and the first one asks the page to offer access.
 */
export class UnavailableFolderFS extends FileSystem {
  private asked = false

  constructor(
    readonly folderName: string,
    private readonly onAccessNeeded: () => void
  ) {
    super(0x6c6f6375, 'localfolder-unavailable')
  }

  private deny(): never {
    if (!this.asked) {
      this.asked = true
      this.onAccessNeeded()
    }
    throw withErrno(
      'EACCES',
      `Access to the local folder "${this.folderName}" must be allowed again; the user can allow it from the prompt in the app`
    )
  }

  async stat(): Promise<InodeLike> {
    return this.deny()
  }
  async readdir(): Promise<string[]> {
    return this.deny()
  }
  async read(): Promise<void> {
    this.deny()
  }
  async write(): Promise<void> {
    this.deny()
  }
  async touch(): Promise<void> {
    this.deny()
  }
  async createFile(): Promise<InodeLike> {
    return this.deny()
  }
  async mkdir(): Promise<InodeLike> {
    return this.deny()
  }
  async unlink(): Promise<void> {
    this.deny()
  }
  async rmdir(): Promise<void> {
    this.deny()
  }
  async rename(): Promise<void> {
    this.deny()
  }
  async link(): Promise<void> {
    this.deny()
  }
  async sync(): Promise<void> {}

  renameSync = notSupported
  statSync = notSupported
  touchSync = notSupported
  createFileSync = notSupported
  unlinkSync = notSupported
  rmdirSync = notSupported
  mkdirSync = notSupported
  readdirSync = notSupported
  linkSync = notSupported
  syncSync = notSupported
  readSync = notSupported
  writeSync = notSupported
}
