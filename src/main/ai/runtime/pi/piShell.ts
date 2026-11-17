import { readFileSync } from 'node:fs'

import { application } from '@application'
import {
  getBinaryExecutionEnv,
  getBinarySearchDirs,
  getBinaryShimsDir,
  mergeBinaryExecutionEnv,
  mergePathSuffixes
} from '@main/utils/binaryEnv'
import { autoDiscoverGitBash, validateGitBashPath } from '@main/utils/commandResolver'
import {
  applyUserMiseContract,
  getMiseEnvEntries,
  hasUserMiseEnv,
  resolveCherryPathTailDirs,
  withCherryShellEnv
} from '@main/utils/shellEnv'

function quoteShellWord(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/** Preserve pi's own PATH prefix while appending directories resolved by the user's login shell. */
export function buildPiLoginPathPrefix(
  loginPath: string | undefined,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  return platform !== 'win32' && loginPath ? `export PATH="$PATH":${quoteShellWord(loginPath)}` : undefined
}

/** Read the one field Cherry honors from the user's global pi settings; absent or malformed means unset. */
function readPiShellPathSetting(): string | undefined {
  try {
    const settings: unknown = JSON.parse(readFileSync(application.getPath('external.pi.settings_file'), 'utf8'))
    const shellPath = (settings as Record<string, unknown> | null)?.shellPath
    return typeof shellPath === 'string' && shellPath.trim() ? shellPath.trim() : undefined
  } catch {
    return undefined
  }
}

export function resolvePiShellPath(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const configured = readPiShellPathSetting()
  if (!configured) return autoDiscoverGitBash() ?? undefined

  const shellPath = validateGitBashPath(configured)
  if (!shellPath) throw new Error(`Configured Pi shellPath is unavailable or is not bash.exe: ${configured}`)
  return shellPath
}

export function mergePiShellExecutionEnv(
  env: NodeJS.ProcessEnv,
  userOwnsMiseFromSnapshot = false
): Record<string, string> {
  const definedEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const binarySearchDirs = getBinarySearchDirs()
  const managedShimsDir = getBinaryShimsDir()
  const standaloneBinaryDirs = binarySearchDirs.filter((directory) => directory !== managedShimsDir)
  // A user mise installation may be visible only as a shims directory in PATH
  // without MISE_* vars, so ownership is detected beyond the MISE_ prefix (#19738).
  const callerOwnsMiseEnvironment = userOwnsMiseFromSnapshot || hasUserMiseEnv(definedEnv)

  if (callerOwnsMiseEnvironment) {
    // A generic shell may already be activated against the user's mise installation. Do not
    // redirect that installation to Cherry's isolated data directory or expose Cherry's shims
    // under an incompatible MISE_* contract. Bundled standalone binaries remain a safe fallback,
    // but stay behind the caller's PATH so they cannot replace the user's own tool versions.
    return mergePathSuffixes(definedEnv, standaloneBinaryDirs, [managedShimsDir])
  }

  return mergeBinaryExecutionEnv(definedEnv, standaloneBinaryDirs)
}

/**
 * Combine snapshot and live MISE vars with live values winning. On Windows env
 * keys are case-insensitive, so same-name keys in different casings collapse to
 * the live spelling instead of coexisting as duplicates.
 */
export function mergeMiseEnvEntries(...sources: Array<Record<string, string>>): Record<string, string> {
  const merged: Record<string, string> = {}
  const isWindows = process.platform === 'win32'
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (isWindows) {
        const existing = Object.keys(merged).find((k) => k.toLowerCase() === key.toLowerCase())
        if (existing) delete merged[existing]
      }
      merged[key] = value
    }
  }
  return merged
}

/**
 * Resolve the login-shell view used for pi's shell prefix and tool spawn env from
 * one raw snapshot. A user-owned mise installation must not see Cherry's shims:
 * a Cherry shim would run under the user's MISE contract (#19738).
 */
export function resolvePiLoginEnv(rawShellEnv: Record<string, string>): Record<string, string> {
  return hasUserMiseEnv(rawShellEnv)
    ? mergePathSuffixes(rawShellEnv, resolveCherryPathTailDirs(true), [getBinaryShimsDir()])
    : withCherryShellEnv(rawShellEnv)
}

/**
 * Env for pi's managed shell tools (bash/PowerShell): the tools spawn directly
 * instead of through the prefixed shell, so the login PATH is layered in here,
 * then the applicable Cherry-managed binary contract, then the user's MISE
 * contract when they own mise (live spawn values win over the stale snapshot).
 */
export function mergePiToolSpawnEnv(
  env: NodeJS.ProcessEnv,
  { loginPath, rawShellEnv }: { loginPath: string | undefined; rawShellEnv: Record<string, string> }
): Record<string, string> {
  const definedEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const loginLayeredEnv = loginPath === undefined ? definedEnv : mergePathSuffixes(definedEnv, loginPath.split(':'))
  const userOwnsMise = hasUserMiseEnv(rawShellEnv) || hasUserMiseEnv(env)
  const merged = mergePiShellExecutionEnv(loginLayeredEnv, userOwnsMise)
  if (userOwnsMise) {
    const userMiseEnv = mergeMiseEnvEntries(
      Object.fromEntries(getMiseEnvEntries(rawShellEnv)),
      Object.fromEntries(getMiseEnvEntries(env))
    )
    applyUserMiseContract(merged, userMiseEnv, getBinaryExecutionEnv())
  }
  return merged
}
