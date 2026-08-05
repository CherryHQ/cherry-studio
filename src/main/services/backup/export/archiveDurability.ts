import { fsyncDirectory, fsyncFile } from '@main/utils/file'

/**
 * Durability seams for atomic archive publication.
 *
 * The temporary archive inode is flushed before the hard-link commit, then the
 * destination directory is flushed after it. Windows cannot fsync a directory
 * handle, so directory sync is a documented no-op there.
 */
export const archiveDurability = {
  async fsyncFile(target: string): Promise<void> {
    await fsyncFile(target)
  },

  async fsyncDir(dir: string): Promise<void> {
    await fsyncDirectory(dir)
  }
}
