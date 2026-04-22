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
 * Editor deep-link schemes. For these we only accept the "open a file" shape
 * produced by `buildEditorUrl()`, so that attacker-supplied links cannot
 * reach other authorities such as `vscode://command/...` (runs registered
 * commands) or `vscode://<publisher>.<extension>/...` (invokes extension URL
 * handlers).
 */
const EDITOR_DEEP_LINK_PROTOCOLS = new Set(['vscode:', 'vscode-insiders:', 'cursor:', 'zed:'])

/**
 * Zed's deep-link format is `zed://file<path>` (no slash separator before
 * the path — Zed strips the `zed://file` prefix and treats the rest as a
 * filesystem path). That means on Unix the URL is `zed://file/abs/path`
 * (host parses as `file`), but on Windows it is `zed://fileC%3A/abs/path`
 * (host parses as `fileC%3A`), so a plain `host === 'file'` check is
 * insufficient. Match the two exact shapes buildEditorUrl() can emit: a
 * slash, or a single-letter encoded drive followed by a slash.
 */
const ZED_FILE_URL_RE = /^zed:\/\/file(\/|[A-Za-z]%3[Aa]\/)/i

/**
 * Check whether a URL is safe to open via shell.openExternal().
 *
 * Only an explicit allowlist of schemes is permitted (web links, mail, and
 * known code-editor deep-links used by the app). Editor schemes are further
 * restricted to the "open a file" URL shape emitted by `buildEditorUrl()` so
 * that attackers cannot smuggle in `vscode://command/...` command URIs,
 * extension URL handlers, or userinfo tricks like `zed://file@evil/...`.
 *
 * @see https://benjamin-altpeter.de/shell-openexternal-dangers/
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return false
    }
    if (EDITOR_DEEP_LINK_PROTOCOLS.has(parsed.protocol)) {
      return isFileOpenEditorUrl(parsed, url)
    }
    return true
  } catch {
    return false
  }
}

function isFileOpenEditorUrl(parsed: URL, rawUrl: string): boolean {
  // Reject userinfo in any form to foil `zed://file@evil/path`-style tricks
  // where "file" ends up as the username and the real host is attacker-chosen.
  if (parsed.username !== '' || parsed.password !== '') {
    return false
  }
  if (parsed.protocol === 'zed:') {
    return ZED_FILE_URL_RE.test(rawUrl)
  }
  // vscode / vscode-insiders / cursor all produce <scheme>://file/<path>,
  // where the URL authority is exactly "file".
  return parsed.host === 'file'
}
