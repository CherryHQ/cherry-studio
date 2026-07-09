import fs from 'node:fs'

import { getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'

/**
 * Reader for the legacy v1 home config file (typically ~/.cherrystudio/config/config.json).
 *
 * The file path is injected via the constructor rather than computed internally,
 * so callers control where the config file is located.
 *
 * Responsibilities:
 *   - Synchronously read and parse the file at construction time.
 *   - Normalize the `appDataPath` field into a `Record<executablePath, dataPath>`.
 *     Handles two historical shapes:
 *       1. Legacy string: `{ "appDataPath": "/some/path" }` — wrapped into a
 *          single-entry record keyed by the normalized executable path.
 *       2. Array: `{ "appDataPath": [{ executablePath, dataPath }, ...] }` —
 *          entries missing either field are skipped.
 *
 * Error handling: the migration pipeline must never crash on a malformed
 * legacy file — all I/O and parse errors are swallowed and surfaced as a
 * `null` return from `getUserDataPath()`.
 *
 * Read-only: this reader does NOT validate whether the `dataPath` on disk
 * is still accessible or writable. That concern belongs to downstream
 * consumers (e.g. the future `initAppDataDir()` rewire).
 *
 * Legacy string entries use the same executable-path normalization as
 * preboot userData resolution. Array entries already carry explicit legacy
 * executable paths, so they are preserved verbatim.
 */
export class LegacyHomeConfigReader {
  private readonly userDataPath: Record<string, string> | null

  constructor(private readonly configFilePath: string) {
    this.userDataPath = this.loadSync()
  }

  /**
   * Return the parsed `appDataPath` as a Record<executablePath, dataPath>,
   * or `null` if:
   *   - the file does not exist
   *   - the file cannot be read (permission, etc.)
   *   - the file contents are not valid JSON
   *   - the `appDataPath` field is missing or of an unexpected type
   *   - the `appDataPath` array is empty or contains only invalid entries
   */
  getUserDataPath(): Record<string, string> | null {
    return this.userDataPath
  }

  private loadSync(): Record<string, string> | null {
    const filePath = this.configFilePath

    let raw: string
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }
      raw = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }

    const appDataPath = (parsed as Record<string, unknown>).appDataPath

    // Legacy string format → single-entry record keyed by current exe.
    if (typeof appDataPath === 'string') {
      if (appDataPath.length === 0) {
        return null
      }
      return { [getNormalizedExecutablePath()]: appDataPath }
    }

    // Array format → filter invalid entries and build a record.
    if (Array.isArray(appDataPath)) {
      const result: Record<string, string> = {}
      for (const entry of appDataPath) {
        if (
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { executablePath?: unknown }).executablePath === 'string' &&
          typeof (entry as { dataPath?: unknown }).dataPath === 'string'
        ) {
          const { executablePath, dataPath } = entry as { executablePath: string; dataPath: string }
          if (executablePath.length > 0 && dataPath.length > 0) {
            result[executablePath] = dataPath
          }
        }
      }
      return Object.keys(result).length > 0 ? result : null
    }

    return null
  }
}
