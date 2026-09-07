import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { toFileUrl, tryFileUrlToPath } from '@shared/utils/file'

/**
 * Browser-only navigation gate for `@cherry/browser` open/fetch.
 *
 * `sanitizeRemoteUrl()` (SSRF guard for direct main-process fetches) must keep
 * rejecting `file:` URLs. This module is the only place where `file://` and
 * absolute file paths are accepted, and only when the user opted in via the
 * `app.browser.allow_file_access` preference (default off).
 *
 * - `http(s)` inputs delegate to `sanitizeRemoteUrl()` unchanged.
 * - `file:` URLs and absolute paths are resolved (symlinks followed via
 *   `realpathSync`), checked on disk (must exist, must be a file, size-capped)
 *   and returned as a canonical `file://` URL suitable for
 *   `BrowserView.loadURL()`. The check is best-effort: it cannot close a
 *   time-of-check/time-of-use race where the file changes between validation
 *   and Chromium loading it, which is acceptable behind the explicit opt-in.
 * - Remote shares (`file://host/...`, UNC `\\host\...`) are always rejected.
 * - Every other scheme (`ftp:`, `javascript:`, `data:`, ...) is rejected.
 *
 * Renderer-initiated navigations (JS `location.href`, in-page links,
 * redirects) bypass `open()`; `CdpBrowserController` re-applies the file
 * branch of this gate in `will-navigate` / `will-frame-navigate` handlers.
 */

export const MAX_BROWSER_LOCAL_FILE_BYTES = 20 * 1024 * 1024

export const BROWSER_FILE_ACCESS_DISABLED_MESSAGE =
  'Local file access is disabled. Enable "Allow browser to open local files" in Settings > General to let @cherry/browser open local files.'

export type BrowserNavigationTarget =
  | { readonly kind: 'http'; readonly url: string }
  | { readonly kind: 'file'; readonly url: string; readonly filePath: string }

export type ResolveBrowserNavigationOptions = {
  /** From the `app.browser.allow_file_access` preference. Default: false. */
  readonly allowFile?: boolean
}

function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

function throwDisabled(): never {
  throw new Error(BROWSER_FILE_ACCESS_DISABLED_MESSAGE)
}

/**
 * Resolve symlinks and verify the target exists as a regular file under the
 * size cap. Returns the canonical path for logging and file-URL formatting.
 */
function validateLocalFile(filePath: string): string {
  let canonical: string
  try {
    canonical = realpathSync(filePath)
  } catch {
    throw new Error(`Local file not found: ${filePath}`)
  }

  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(canonical)
  } catch {
    throw new Error(`Local file not found: ${filePath}`)
  }

  if (stat.isDirectory()) {
    throw new Error(`Local file path is a directory, not a file: ${filePath}`)
  }

  if (!stat.isFile()) {
    throw new Error(`Local file path is not a regular file: ${filePath}`)
  }

  if (stat.size > MAX_BROWSER_LOCAL_FILE_BYTES) {
    throw new Error(
      `Local file too large (${stat.size} bytes exceeds ${MAX_BROWSER_LOCAL_FILE_BYTES} bytes): ${filePath}`
    )
  }

  return canonical
}

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(homedir(), input.slice(2))
  return input
}

/** True for inputs handled by the local-file branch (vs http(s) branch). */
export function isBrowserFileInput(rawUrl: string): boolean {
  const input = stripSurroundingQuotes(rawUrl).trim()
  if (!input) return false
  if (/^file:/i.test(input)) return true
  if (/^[A-Za-z]:[\\/]/.test(input)) return true
  if (input.startsWith('\\\\')) return true
  // Single leading slash = POSIX absolute path. `//host/...` is handled by
  // the caller as a remote share (never a local file).
  if (input.startsWith('/') && !input.startsWith('//')) return true
  if (input === '~' || input.startsWith('~/') || input.startsWith('~\\')) return true
  return false
}

function resolveFileUrlTarget(rawUrl: string): BrowserNavigationTarget {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid browser url: ${rawUrl}`)
  }

  if (parsed.protocol !== 'file:') {
    throw new Error(`Invalid browser url: ${rawUrl}`)
  }

  if (parsed.username || parsed.password) {
    throw new Error('Unsafe browser url: credentials are not allowed')
  }

  // Per RFC 8089, a `localhost` authority means the local machine, exactly
  // like an empty authority — only other hosts are remote shares.
  if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') {
    throw new Error(`Remote file shares are not allowed: ${rawUrl}`)
  }
  parsed.hostname = ''

  const filePath = tryFileUrlToPath(parsed.href)
  if (!filePath) {
    throw new Error(`Invalid browser url: ${rawUrl}`)
  }

  const canonical = validateLocalFile(filePath)

  // Load the validated canonical path (not the possibly symlinked input), so
  // the check and the load cannot diverge. The fragment is preserved for
  // section anchors; the query is dropped — it is not part of file identity.
  const url = toFileUrl(AbsoluteFilePathSchema.parse(canonical)) + parsed.hash
  return { kind: 'file', url, filePath: canonical }
}

function resolveBarePathTarget(rawPath: string): BrowserNavigationTarget {
  let input = expandHome(stripSurroundingQuotes(rawPath))

  // Extended-length prefix: `\\?\C:\...` (or `//?/C:/...`) addresses a local
  // path, while `\\?\UNC\server\share` (or `//?/UNC/...`) is a remote share.
  const extended = /^[\\/][\\/]\?[\\/](.*)$/.exec(input)
  if (extended) {
    if (/^UNC[\\/]/i.test(extended[1])) {
      throw new Error(`Remote file shares are not allowed: ${rawPath}`)
    }
    input = extended[1]
  }

  // UNC `\\server\share` (or `//server/share`) always points at a remote host.
  if (input.startsWith('\\\\') || input.startsWith('//')) {
    throw new Error(`Remote file shares are not allowed: ${rawPath}`)
  }

  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(input)
  const isPosixAbsolute = input.startsWith('/') && !input.startsWith('//')
  const isHomeAbsolute = input === homedir() || input.startsWith(`${homedir()}${path.sep}`)
  const isAbsolute =
    isWindowsAbsolute || isPosixAbsolute || isHomeAbsolute || path.isAbsolute(input) || path.win32.isAbsolute(input)

  if (!isAbsolute) {
    throw new Error(`Local file path must be absolute: ${rawPath}`)
  }

  // Keep Windows drive paths in forward-slash form so validation and file-URL
  // formatting behave identically on every platform (tests run on Linux too).
  const normalized = isWindowsAbsolute ? input.replace(/\\/g, '/') : input

  const canonical = validateLocalFile(normalized)

  const url = toFileUrl(AbsoluteFilePathSchema.parse(canonical))
  return { kind: 'file', url, filePath: canonical }
}

/**
 * Resolve a `@cherry/browser` open/fetch target to a URL safe for
 * `BrowserView.loadURL()`. Throws with a model-actionable message otherwise.
 */
export function resolveBrowserNavigationTarget(
  rawUrl: string,
  options: ResolveBrowserNavigationOptions = {}
): BrowserNavigationTarget {
  const allowFile = options.allowFile === true
  const input = stripSurroundingQuotes(rawUrl).trim()

  if (!input) {
    throw new Error(`Invalid browser url: ${rawUrl}`)
  }

  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(input)
  // NOTE: single-letter `C:\...` / `C:/...` drive paths look like a `C:` scheme;
  // they are local files, not URLs — the file branches below own them.
  const isDrivePath = /^[a-zA-Z]:[\\/]/.test(input)
  if (schemeMatch && !isDrivePath && !/^https?:/i.test(input) && !/^file:/i.test(input)) {
    throw new Error(`Invalid browser url: ${rawUrl}`)
  }

  if (/^file:/i.test(input)) {
    if (!allowFile) throwDisabled()
    return resolveFileUrlTarget(input)
  }

  // `//host/...` carries a remote authority (UNC `//server/share` or a
  // protocol-relative URL, neither of which is openable here).
  if (/^\/\/[^/]/.test(input)) {
    if (!allowFile) throwDisabled()
    throw new Error(`Remote file shares are not allowed: ${rawUrl}`)
  }

  if (isBrowserFileInput(input)) {
    if (!allowFile) throwDisabled()
    return resolveBarePathTarget(input)
  }

  try {
    return { kind: 'http', url: sanitizeRemoteUrl(input) }
  } catch (error) {
    // A relative filesystem path (e.g. `report/out.html`) is neither a valid
    // URL nor an allowed absolute path — point the model at the real problem.
    if (
      /[\\/]/.test(input) &&
      (input.includes('\\') || /^\.{1,2}[\\/]/.test(input) || /\.(html?|pdf|md|txt|xhtml)([#?]|$)/i.test(input))
    ) {
      throw new Error(`Local file path must be absolute: ${rawUrl}`)
    }
    throw error
  }
}

/**
 * Drop-in replacement for `sanitizeRemoteUrl()` inside the browser controller.
 * Returns the normalized URL string to navigate to.
 */
export function resolveBrowserNavigationUrl(rawUrl: string, options: ResolveBrowserNavigationOptions = {}): string {
  return resolveBrowserNavigationTarget(rawUrl, options).url
}
