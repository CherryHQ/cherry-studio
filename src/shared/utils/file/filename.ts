/**
 * Filename validation + sanitization — pure-string utilities usable from both
 * main and renderer. Promoted from `src/main/utils/file/legacyFile.ts` per
 * the `v2-refactor-temp/docs/file-manager/utils-file-migration.md` Phase 1b.1
 * plan: this module is the SoT; `legacyFile.ts` re-exports for back-compat
 * during the consumer-migration window.
 *
 * Platform notes:
 * - Windows: rejects `< > : " / \ | ? *` and reserved names (CON / PRN /
 *   AUX / NUL / COM1-9 / LPT1-9), plus filenames ending in `.` or space.
 * - macOS: additionally rejects `:` (HFS / Finder convention).
 * - Linux / other Unix: additionally rejects `/`.
 * - All platforms: rejects empty strings, lengths > 255, and embedded
 *   `NUL` (`\0`) characters.
 *
 * The legacy implementation lived in `legacyFile.ts:400` (validate) and
 * `legacyFile.ts:473` (sanitize); their behaviour is preserved verbatim.
 * `checkName` is intentionally NOT moved here because it logs through the
 * main-process `loggerService`; that helper stays in `legacyFile.ts` until a
 * shared logging surface lands.
 */

export type ValidateFileNameResult = { valid: true } | { valid: false; error: string }

/**
 * Validate a filename against the host platform's rules.
 *
 * Pass an explicit `platform` to validate against a different OS than the
 * runtime — used by tests and by the migration path that has to honour the
 * source OS's filename conventions.
 */
export function validateFileName(
  fileName: string,
  platform: NodeJS.Platform = process.platform
): ValidateFileNameResult {
  if (!fileName) {
    return { valid: false, error: 'File name cannot be empty' }
  }

  if (fileName.length === 0 || fileName.length > 255) {
    return { valid: false, error: 'File name length must be between 1 and 255 characters' }
  }

  if (fileName.includes('\0')) {
    return { valid: false, error: 'File name cannot contain null characters.' }
  }

  if (platform === 'win32') {
    const winInvalidChars = /[<>:"/\\|?*]/
    if (winInvalidChars.test(fileName)) {
      return { valid: false, error: 'File name contains characters not supported by Windows: < > : " / \\ | ? *' }
    }
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
    if (reservedNames.test(fileName)) {
      return { valid: false, error: 'File name is a Windows reserved name.' }
    }
    if (fileName.endsWith('.') || fileName.endsWith(' ')) {
      return { valid: false, error: 'File name cannot end with a dot or a space' }
    }
  }

  if (platform !== 'win32') {
    if (fileName.includes('/')) {
      return { valid: false, error: 'File name cannot contain slashes /' }
    }
  }

  if (platform === 'darwin') {
    if (fileName.includes(':')) {
      return { valid: false, error: 'macOS filenames cannot contain a colon :' }
    }
  }

  return { valid: true }
}

/**
 * Replace forbidden characters in a filename so the result can be written on
 * any of Windows / macOS / Linux. Returns the empty string for empty input,
 * and `'untitled'` if every character was sanitised away.
 *
 * Steps (in order):
 * 1. Replace `< > : " / \ | ? *` and ASCII control chars (0x00-0x1f) with `replacement`.
 * 2. Replace Windows-reserved prefixes (CON / PRN / AUX / NUL / COM1-9 /
 *    LPT1-9) — preserves the trailing `.<ext>` or end-of-string.
 * 3. Trim trailing whitespace and dots (Windows convention).
 * 4. Truncate to 255 characters (filesystem limit).
 */
export function sanitizeFilename(fileName: string, replacement = '_'): string {
  if (!fileName) return ''

  let sanitized = fileName
    // oxlint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, replacement)
    .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, `${replacement}$2`)
    .replace(/[\s.]+$/, '')
    .substring(0, 255)

  if (!sanitized) {
    sanitized = 'untitled'
  }

  return sanitized
}
