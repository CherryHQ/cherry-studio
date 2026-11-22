import { accessSync, constants, opendirSync, statSync } from 'node:fs'
import { access, opendir, stat } from 'node:fs/promises'

export function isDirectoryAccessible(directoryPath: string): boolean {
  try {
    if (!statSync(directoryPath).isDirectory()) return false
    accessSync(directoryPath, constants.R_OK | constants.X_OK)
    const directory = opendirSync(directoryPath)
    try {
      directory.readSync()
    } finally {
      directory.closeSync()
    }
    return true
  } catch {
    return false
  }
}

/** Same check as `isDirectoryAccessible`, without blocking the main thread on a slow or stalled mount. */
export async function isDirectoryAccessibleAsync(directoryPath: string): Promise<boolean> {
  try {
    if (!(await stat(directoryPath)).isDirectory()) return false
    await access(directoryPath, constants.R_OK | constants.X_OK)
    const directory = await opendir(directoryPath)
    try {
      await directory.read()
    } finally {
      await directory.close()
    }
    return true
  } catch {
    return false
  }
}
