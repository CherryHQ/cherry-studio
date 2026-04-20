/**
 * Security utility functions for the main process.
 */

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'obsidian:'])

/**
 * Check whether a URL is safe to open via shell.openExternal().
 *
 * Only http(s) and mailto links are allowed. This prevents attackers from
 * abusing custom protocol handlers (e.g. file://, ms-msdt:, calculator:)
 * to execute local files or launch arbitrary applications.
 *
 * @see https://benjamin-altpeter.de/shell-openexternal-dangers/
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}
