import { open } from 'node:fs/promises'

/**
 * Durability seams for atomic archive publication.
 *
 * The temporary archive inode is flushed before the hard-link commit, then the
 * destination directory is flushed after it. Windows cannot fsync a directory
 * handle, so directory sync is a documented no-op there.
 */
export const archiveDurability = {
  async fsyncFile(target: string): Promise<void> {
    const handle = await open(target, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },

  async fsyncDir(dir: string): Promise<void> {
    if (process.platform === 'win32') return
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}
