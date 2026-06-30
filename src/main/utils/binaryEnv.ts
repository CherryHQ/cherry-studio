import { application } from '@application'
import { isWin } from '@main/core/platform'
import path from 'path'

/**
 * Layout and environment primitives for Cherry-managed binaries — where the
 * binaries live and what Cherry injects into a child process's env, independent
 * of how the base env is obtained. Two scenarios consume these: the **execution**
 * path (running installed binaries; see `shellEnv.ts`, which captures the user's
 * real shell env first) and the **install** path (the mise install subprocess;
 * see `BinaryManager.buildIsolatedEnv`, which isolates the user's env). Kept as a
 * dependency-free leaf so both can share the primitives without pulling in the
 * other's machinery.
 */

/** Root dir for all Cherry-managed binary state (mise data, shims, isolated home). */
function binaryDataDir(): string {
  return application.getPath('feature.binary.data')
}

/** The mise shims dir — where installed-tool shim executables land. */
function binaryShimsDir(): string {
  return path.join(binaryDataDir(), 'shims')
}

/**
 * Directories that hold Cherry-managed binaries, in resolution order:
 * mise shims first (user-installed wins), then `cherry.bin` (bundled fallback).
 *
 * Single source of truth for the binary path layout — `getBinaryPath()`
 * (binaryResolver.ts) and the PATH-appending logic in `shellEnv.ts` consume this. Do not hand-join
 * `cherry.bin` / `feature.binary.data` elsewhere.
 */
export function getBinarySearchDirs(): string[] {
  return [binaryShimsDir(), application.getPath('cherry.bin')]
}

/**
 * Env injected into every process that *runs* a managed binary (the CLIs, the
 * mise shims, ripgrep, …). Carries only `MISE_*` so the shims resolve against
 * Cherry's isolated mise data dir.
 *
 * Deliberately does NOT relocate `HOME`/`XDG_*`: the tools we launch
 * (claude/codex/gemini/qwen, the OpenClaw gateway) must read the user's real
 * home for their config and credentials. HOME/XDG isolation belongs only to the
 * mise *install* subprocess — see `getBinaryIsolatedHomeEnv()`.
 */
export function getBinaryExecutionEnv(): Record<string, string> {
  const dataDir = binaryDataDir()
  return {
    MISE_DATA_DIR: dataDir,
    MISE_CONFIG_DIR: path.join(dataDir, 'config'),
    MISE_CACHE_DIR: path.join(dataDir, 'cache'),
    MISE_STATE_DIR: path.join(dataDir, 'state'),
    MISE_SHIMS_DIR: binaryShimsDir(),
    MISE_YES: '1',
    MISE_NO_ANALYTICS: '1',
    MISE_EXPERIMENTAL: '1'
  }
}

/**
 * `HOME`/`XDG_*` relocated into Cherry's isolated binary data dir. Used ONLY by
 * the mise install subprocess (`BinaryManager.buildIsolatedEnv`) so mise and the
 * package managers it drives cannot read user-level config/creds
 * (`~/.npmrc`, `~/.netrc`, …). Never fold this into the shared execution env, or
 * the launched CLIs read their config/creds from the isolated dir and appear
 * logged-out on every run.
 */
export function getBinaryIsolatedHomeEnv(): Record<string, string> {
  const dataDir = binaryDataDir()
  return {
    HOME: path.join(dataDir, 'home'),
    XDG_CONFIG_HOME: path.join(dataDir, 'xdg', 'config'),
    XDG_CACHE_HOME: path.join(dataDir, 'xdg', 'cache'),
    XDG_STATE_HOME: path.join(dataDir, 'xdg', 'state')
  }
}

// `extraPathPrefixes` are prepended after the mise shims dir but before the
// caller's existing PATH — used by the mise install subprocess to put mise's own
// dir on PATH so a re-exec'd child mise resolves.
export function mergeBinaryExecutionEnv(
  env: Record<string, string>,
  extraPathPrefixes: string[] = []
): Record<string, string> {
  const binaryEnv = getBinaryExecutionEnv()
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || (isWin ? 'Path' : 'PATH')
  const pathSeparator = isWin ? ';' : path.delimiter
  const pathValue = [binaryEnv.MISE_SHIMS_DIR, ...extraPathPrefixes, env[pathKey] || env.PATH || '']
    .filter(Boolean)
    .join(pathSeparator)
  const merged = { ...env, ...binaryEnv, [pathKey]: pathValue }
  if (!isWin) merged.PATH = pathValue
  return merged
}
