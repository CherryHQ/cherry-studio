import path from 'node:path'

/**
 * What one Agent adds to the base sandbox. Only these fields are read; anything else an overlay
 * carries is ignored.
 */
export interface SandboxOverlay {
  readonly allowedDomains?: readonly string[]
  readonly deniedDomains?: readonly string[]
  readonly writablePaths?: readonly string[]
}

/**
 * A runtime-neutral sandbox for one session: no network except `allowedDomains`, writes limited to
 * the session workspace, the Agent data directory, the temp directory and `writablePaths`. Strict
 * allowlisting, approval to leave the sandbox, and the absence of Apple Events, Unix socket and
 * nested user namespace access are invariants of every adapter, so the policy has no field for them.
 */
export interface SandboxPolicy {
  readonly allowedDomains: readonly string[]
  readonly deniedDomains: readonly string[]
  readonly writablePaths: readonly string[]
}

const BASE_SANDBOX_POLICY: SandboxPolicy = { allowedDomains: [], deniedDomains: [], writablePaths: [] }

const SHELL_STARTUP_FILES = new Set([
  '.bash_login',
  '.bash_profile',
  '.bashrc',
  '.profile',
  '.zlogin',
  '.zprofile',
  '.zshenv',
  '.zshrc'
])

/**
 * Merges an Agent's overlay into the base policy. Returns `undefined` when the Agent declares no
 * overlay or the platform has no zero-setup sandbox (only macOS does).
 */
export function resolveSandboxPolicy(
  overlay: SandboxOverlay | undefined,
  platform: NodeJS.Platform,
  homeDir: string
): SandboxPolicy | undefined {
  if (!overlay || platform !== 'darwin') return undefined
  const deniedDomains = unique([...BASE_SANDBOX_POLICY.deniedDomains, ...(overlay.deniedDomains ?? [])])
  return {
    allowedDomains: unique([...BASE_SANDBOX_POLICY.allowedDomains, ...(overlay.allowedDomains ?? [])]).filter(
      (domain) => !deniedDomains.includes(domain)
    ),
    deniedDomains,
    writablePaths: unique([...BASE_SANDBOX_POLICY.writablePaths, ...(overlay.writablePaths ?? [])])
      .map((entry) => expandHome(entry, homeDir))
      .filter((entry): entry is string => entry !== undefined && !isProtectedWritePath(entry, homeDir))
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function expandHome(entry: string, homeDir: string): string | undefined {
  const expanded = entry === '~' || entry.startsWith('~/') ? path.posix.join(homeDir, entry.slice(1)) : entry
  return path.posix.isAbsolute(expanded) ? trimTrailingSlash(path.posix.normalize(expanded)) : undefined
}

function trimTrailingSlash(entry: string): string {
  return entry === '/' ? entry : entry.replace(/\/+$/, '')
}

function isProtectedWritePath(entry: string, homeDir: string): boolean {
  const home = trimTrailingSlash(path.posix.normalize(homeDir))
  const containsHome = entry === '/' || entry === home || home.startsWith(`${entry}/`)
  const isStartupFile = path.posix.dirname(entry) === home && SHELL_STARTUP_FILES.has(path.posix.basename(entry))
  return containsHome || isStartupFile
}
