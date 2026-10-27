import { readFileSync } from 'node:fs'

import { application } from '@application'
import {
  getBinarySearchDirs,
  getBinaryShimsDir,
  mergeBinaryExecutionEnv,
  mergePathSuffixes
} from '@main/utils/binaryEnv'
import { autoDiscoverGitBash, validateGitBashPath } from '@main/utils/commandResolver'

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

export function mergePiBashExecutionEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const definedEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const binarySearchDirs = getBinarySearchDirs()
  const managedShimsDir = getBinaryShimsDir()
  const standaloneBinaryDirs = binarySearchDirs.filter((directory) => directory !== managedShimsDir)
  const callerOwnsMiseEnvironment = Object.keys(definedEnv).some((key) => key.toUpperCase().startsWith('MISE_'))

  if (callerOwnsMiseEnvironment) {
    // Respect the caller's mise installation; Cherry shims require a different MISE_* environment.
    // Standalone binaries stay behind the caller's PATH to preserve their selected versions.
    return mergePathSuffixes(definedEnv, standaloneBinaryDirs, [managedShimsDir])
  }

  return mergeBinaryExecutionEnv(definedEnv, standaloneBinaryDirs)
}
