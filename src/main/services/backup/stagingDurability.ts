import fs from 'node:fs'
import path from 'node:path'

/** Test seam for the two durability operations; production uses real fsync. */
export const restoreStagingDurability = {
  syncFile(target: string): void {
    const fd = fs.openSync(target, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  },

  syncDirectory(target: string): void {
    if (process.platform === 'win32') return
    const fd = fs.openSync(target, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
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
