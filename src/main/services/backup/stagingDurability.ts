import fs from 'node:fs'
import path from 'node:path'

import { fsyncDirectorySync, fsyncFileSync } from '@main/utils/file'

/** Test seam for the two durability operations; production uses real fsync. */
export const restoreStagingDurability = {
  syncFile(target: string): void {
    fsyncFileSync(target)
  },

  syncDirectory(target: string): void {
    fsyncDirectorySync(target)
  }
}

/**
 * Flush an operation-owned restore tree before a journal may name it. POSIX
 * flushes files plus directories bottom-up, including the root's parent, for
 * sudden-power-loss durability. Windows flushes file contents but cannot fsync
 * directory metadata through Node, so its contract is process-crash recovery.
 */
export function durabilizeRestoreStaging(root: string): void {
  function walk(directory: string): void {
    for (const name of fs.readdirSync(directory)) {
      const child = path.join(directory, name)
      const stats = fs.lstatSync(child)
      if (stats.isSymbolicLink()) {
        throw new Error(`restore staging contains a symlink: ${child}`)
      }
      if (stats.isDirectory()) {
        walk(child)
      } else if (stats.isFile()) {
        restoreStagingDurability.syncFile(child)
      } else {
        throw new Error(`restore staging contains a special node: ${child}`)
      }
    }
    restoreStagingDurability.syncDirectory(directory)
  }

  walk(root)
  restoreStagingDurability.syncDirectory(path.dirname(root))
}
