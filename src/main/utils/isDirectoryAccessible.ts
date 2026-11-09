import { accessSync, constants, opendirSync, statSync } from 'node:fs'

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
