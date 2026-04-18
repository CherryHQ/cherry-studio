import fs from 'node:fs'

import { app } from 'electron'

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
 *          single-entry record keyed by the current `app.getPath('exe')`.
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
 * Known limitation: AppImage / Windows portable builds write a special
 * `executablePath` (cherry-studio.appimage / cherry-studio-portable.exe)
 * that differs from `app.getPath('exe')`. This reader does not reproduce
 * that normalization — the legacy-string fallback uses the raw exe path,
 * and array entries are preserved verbatim. Consumers of `app.user_data_path`
 * will need their own exe-path normalization (see `src/main/utils/init.ts:51-60`).
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
      return { [app.getPath('exe')]: appDataPath }
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
