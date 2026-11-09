import { accessSync, constants, statSync } from 'node:fs'

export function isDirectoryAccessible(directoryPath: string): boolean {
  try {
    if (!statSync(directoryPath).isDirectory()) return false
    accessSync(directoryPath, constants.R_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}
