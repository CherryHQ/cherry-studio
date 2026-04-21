/**
 * Security utility functions for the main process.
 */

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'obsidian:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
  'zed:'
])

/**
 * Editor deep-link schemes. For these we only accept the "open a file"
 * authority (`<scheme>://file/...`) produced by `buildEditorUrl()`, so that
 * attacker-supplied links cannot reach other authorities such as
 * `vscode://command/...` (runs registered commands) or
 * `vscode://<publisher>.<extension>/...` (invokes extension URL handlers).
 */
const EDITOR_DEEP_LINK_PROTOCOLS = new Set(['vscode:', 'vscode-insiders:', 'cursor:', 'zed:'])

/**
 * Check whether a URL is safe to open via shell.openExternal().
 *
 * Only an explicit allowlist of schemes is permitted (web links, mail, and
 * known code-editor deep-links used by the app). Editor schemes are further
 * restricted to the `file` authority to match what `buildEditorUrl()` emits.
 * This prevents attackers from abusing custom protocol handlers (e.g.
 * file://, ms-msdt:, calculator:, vscode://command) to execute local files,
 * launch arbitrary applications, or trigger editor commands.
 *
 * @see https://benjamin-altpeter.de/shell-openexternal-dangers/
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return false
    }
    if (EDITOR_DEEP_LINK_PROTOCOLS.has(parsed.protocol) && parsed.host !== 'file') {
      return false
    }
    return true
  } catch {
    return false
  }
}
