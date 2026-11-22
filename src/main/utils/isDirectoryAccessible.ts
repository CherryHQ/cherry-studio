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

export const DIRECTORY_PROBE_TIMEOUT_MS = 5000

/** Reject if a filesystem probe on a stalled mount does not settle in time. */
export function withProbeTimeout<T>(probe: Promise<T>, timeoutMs = DIRECTORY_PROBE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Filesystem probe timed out')), timeoutMs)
  })
  return Promise.race([probe, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Same check as `isDirectoryAccessible`, without blocking the main thread on a slow or stalled
 * mount. A probe that does not settle within the timeout counts as inaccessible, so callers get a
 * bounded, recoverable answer.
 */
export function isDirectoryAccessibleAsync(
  directoryPath: string,
  timeoutMs = DIRECTORY_PROBE_TIMEOUT_MS
): Promise<boolean> {
  return withProbeTimeout(probeDirectory(directoryPath), timeoutMs).catch(() => false)
}

async function probeDirectory(directoryPath: string): Promise<boolean> {
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
