import { application } from '@application'
import { isWin } from '@main/core/platform'
import path from 'path'

/**
 * Layout and environment primitives for Cherry-managed binaries — where the
 * binaries live and what Cherry injects into a child process's env, independent
 * of how the base env is obtained. Two scenarios consume these: the **execution**
 * path (running installed binaries; see `shellEnv.ts`, which captures the user's
 * real shell env first) and the **install** path (the mise install subprocess;
 * see `BinaryManager.buildIsolatedEnv`, which isolates the user's env). Kept
 * free of `shellEnv` / `BinaryManager` imports so both can share these
 * primitives without pulling in the other's machinery.
 */

/**
 * Collapse a list of PATH segments to unique entries, first occurrence wins.
 * On Windows the compare is case-insensitive (the filesystem is), so `C:\Foo`
 * and `c:\foo` fold together; elsewhere it is case-sensitive. Blank segments
 * are dropped. Order is preserved — never sorted — because it is load-bearing
 * on Windows, where the shims dir must stay ahead of the system PATH.
 *
 * The single home for this canonicalization: both `mergeBinaryExecutionEnv`
 * here and `shellEnv.appendCherryToolDirsToPath` run it back-to-back on the
 * same PATH during shell capture, so they must agree byte-for-byte.
 */
export function dedupePathSegments(segments: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const canonical = isWin ? path.normalize(trimmed).toLowerCase() : path.normalize(trimmed)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    unique.push(trimmed)
  }
  return unique
}

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
  const pathSeparator = isWin ? ';' : path.delimiter
  // Windows env keys are case-insensitive, so the input can carry several PATH
  // casings (`Path`, `PATH`). Gather segments from every one of them and collapse
  // the output to a single key — otherwise a stale casing left untouched can
  // shadow the merged value when the child process spawns, losing the shims-first
  // ordering this function guarantees.
  const pathLikeKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
  const pathKey = pathLikeKeys[0] || (isWin ? 'Path' : 'PATH')
  // Shims dir first, then any caller prefixes, then the incoming PATH — deduped
  // (first occurrence wins) so prepending the shims dir can't double it up when
  // the caller's PATH already carries it (shellEnv appends the same tool dirs
  // upstream).
  const pathValue = dedupePathSegments([
    binaryEnv.MISE_SHIMS_DIR,
    ...extraPathPrefixes,
    ...pathLikeKeys.flatMap((key) => (env[key] || '').split(pathSeparator))
  ]).join(pathSeparator)
  const merged = { ...env, ...binaryEnv }
  for (const key of pathLikeKeys) delete merged[key]
  merged[pathKey] = pathValue
  if (!isWin) merged.PATH = pathValue
  return merged
}
