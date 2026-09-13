import { spawn } from 'child_process'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/core/platform'

import { dedupePathSegments, getBinarySearchDirs, getBinaryShimsDir, mergeBinaryExecutionEnv } from './binaryEnv'
import { getBundledGitDir } from './bundledGit'

const logger = loggerService.withContext('ShellEnv')

// Give shells enough time to source profile files, but fail fast when they hang.
const SHELL_ENV_TIMEOUT_MS = 15_000

/** Read PATH: exact `PATH` on POSIX (env keys are case-sensitive), case-insensitive on Windows. */
export function getPathFromEnvironment(env: Record<string, string | undefined>): string | undefined {
  if (!isWin) return env.PATH
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
  return pathKey ? env[pathKey] : undefined
}

/** Whether a PATH string contains a user mise-owned directory (`mise/shims`, `mise/installs`). */
export function hasMiseInPath(pathValue: string | undefined): boolean {
  if (!pathValue) return false
  const delimiter = isWin ? ';' : ':'
  // Cherry's own data dir is `.../Toolchain/mise`, so its managed shims dir
  // (`.../mise/shims`) matches the pattern below. Never count it as user mise:
  // a login PATH already carrying Cherry tails (e.g. Pi's bash-hook layering)
  // would otherwise read as user-owned for users without mise.
  const normalizeDir = (value: string) => value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const cherryShimsDir = normalizeDir(getBinaryShimsDir())
  const isCherryShimsDir = (segment: string) => {
    const cleaned = normalizeDir(segment)
    return isWin ? cleaned.toLowerCase() === cherryShimsDir.toLowerCase() : cleaned === cherryShimsDir
  }
  return pathValue
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !isCherryShimsDir(segment))
    .some((segment) => /(^|[\\/])\.?mise[\\/](shims|installs)([\\/]|$)/i.test(segment))
}

export function isMiseEnvVar(key: string): boolean {
  return isWin ? key.toUpperCase().startsWith('MISE_') : key.startsWith('MISE_')
}

export function getMiseEnvEntries(env: Record<string, string | undefined>): Array<[string, string]> {
  return Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && isMiseEnvVar(entry[0])
  )
}

/** Whether an env shows a user-owned mise installation: MISE_* vars or a mise-owned PATH dir. */
export function hasUserMiseEnv(env: Record<string, string | undefined>): boolean {
  if (getMiseEnvEntries(env).length > 0) return true
  // On POSIX PATH is case-sensitive: a lowercase `path` entry is an unrelated
  // variable and must not count as a mise-owned PATH dir.
  return hasMiseInPath(isWin ? getPathFromEnvironment(env) : env.PATH)
}

/**
 * Cherry PATH tail dirs for a spawned child: standalone binaries always, the
 * managed shims dir only when the user has no mise of their own (else a Cherry
 * shim would run under the user's MISE contract), bundled git last (#19738).
 */
export function resolveCherryPathTailDirs(hasUserMise: boolean): string[] {
  const cherryToolDirs = getBinarySearchDirs()
  const managedShimsDir = getBinaryShimsDir()
  const standaloneDirs = cherryToolDirs.filter((dir) => dir !== managedShimsDir)
  const bundledGitDir = getBundledGitDir()
  if (hasUserMise) return bundledGitDir ? [...standaloneDirs, bundledGitDir] : standaloneDirs
  return bundledGitDir ? [...cherryToolDirs, bundledGitDir] : cherryToolDirs
}

/** Drop one directory from every PATH key in `env`, matching Windows paths case-insensitively. */
export function removePathEntry(env: Record<string, string | undefined>, dir: string): void {
  if (!dir) return
  const target = isWin ? path.normalize(dir).toLowerCase() : path.normalize(dir)
  const delimiter = isWin ? ';' : ':'
  const normalize = (value: string) => (isWin ? path.normalize(value).toLowerCase() : path.normalize(value))
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
  for (const key of pathKeys) {
    const value = env[key]
    if (typeof value !== 'string' || !value) continue
    env[key] = value
      .split(delimiter)
      .filter((segment) => normalize(segment.trim()) !== target)
      .join(delimiter)
  }
  if (!isWin && pathKeys.length > 0 && !pathKeys.includes('PATH')) {
    env.PATH = env[pathKeys[0]]
  }
}

/**
 * Replace Cherry's isolated MISE contract in `target` with the user's mise env:
 * drop Cherry-only MISE keys, then restore the user's values. A PATH-only user
 * mise install leaves `userMiseEnv` empty — the merge that ran before may then
 * have prepended Cherry's shims, so they are dropped too.
 */
export function applyUserMiseContract(
  target: Record<string, string | undefined>,
  userMiseEnv: Record<string, string>,
  cherryMiseEnv: Record<string, string>
): void {
  const isWindows = isWin
  const userMiseKeysNormalized = new Set(Object.keys(userMiseEnv).map((k) => (isWindows ? k.toUpperCase() : k)))
  for (const key of Object.keys(cherryMiseEnv)) {
    const normalizedKey = isWindows ? key.toUpperCase() : key
    if (!userMiseKeysNormalized.has(normalizedKey)) {
      const existingKey = Object.keys(target).find((k) =>
        isWindows ? k.toUpperCase() === key.toUpperCase() : k === key
      )
      if (existingKey) delete target[existingKey]
    }
  }
  if (isWindows) {
    for (const key of Object.keys(userMiseEnv)) {
      const existingKey = Object.keys(target).find((k) => k.toLowerCase() === key.toLowerCase() && k !== key)
      if (existingKey) delete target[existingKey]
    }
  }
  Object.assign(target, userMiseEnv)
  removePathEntry(target, getBinaryShimsDir())
}

/**
 * Ensures Cherry-managed tool directories are appended to the user's PATH while
 * preserving the original key casing and avoiding duplicate segments.
 */
const appendCherryToolDirsToPath = (env: Record<string, string>) => {
  const pathSeparator = isWin ? ';' : ':'
  const cherryToolDirs = getBinarySearchDirs()
  // Bundled MinGit as a last-resort git: appended after the managed tool dirs so
  // it lands at the very tail, letting any spawned process (agent, CLI) resolve a
  // bare `git` with no system git — while system/mise/PATH git always win ahead.
  const bundledGitDir = getBundledGitDir()
  const tailDirs = bundledGitDir ? [...cherryToolDirs, bundledGitDir] : cherryToolDirs
  // POSIX env keys are case-sensitive: only the exact `PATH` feeds the append,
  // so an unrelated lowercase `path` variable is left alone.
  const pathKeys = isWin
    ? Object.keys(env).filter((key) => key.toLowerCase() === 'path')
    : Object.keys(env).filter((key) => key === 'PATH')
  const canonicalPathKey = pathKeys[0] || (isWin ? 'Path' : 'PATH')
  const existingPathValue = env[canonicalPathKey] || env.PATH || ''

  // Existing segments first, tool dirs appended — dedup keeps an already-present
  // tool dir at its original position instead of moving it to the tail.
  const updatedPath = dedupePathSegments([...existingPathValue.split(pathSeparator), ...tailDirs]).join(pathSeparator)

  if (pathKeys.length > 0) {
    pathKeys.forEach((key) => {
      env[key] = updatedPath
    })
  } else {
    env[canonicalPathKey] = updatedPath
  }

  if (!isWin) {
    env.PATH = updatedPath
  }
}

const applyBinaryExecutionEnv = (env: Record<string, string>) => {
  const merged = mergeBinaryExecutionEnv(env)
  Object.keys(env).forEach((key) => delete env[key])
  Object.assign(env, merged)
}

/**
 * Replace `%VAR%` references with values from `env` (case-insensitive lookup).
 */
function expandWindowsEnvVars(value: string, env: Record<string, string>): string {
  return value.replace(/%([^%]+)%/g, (original, varName: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === varName.toLowerCase())
    return key ? env[key] : original
  })
}

/**
 * Read the **current** system + user PATH from the Windows registry and expand
 * embedded `%VAR%` references so callers get a ready-to-use PATH string.
 * Returns null when both registry reads fail.
 */
async function readWindowsRegistryPath(env: Record<string, string>): Promise<string | null> {
  try {
    const { HKEY, RegistryValueType, enumerateValuesSafe } = await import('registry-js')
    const readPathValue = (hive: (typeof HKEY)[keyof typeof HKEY], subkey: string): string | null => {
      const pathValue = enumerateValuesSafe(hive, subkey).find(
        (value) =>
          value.name.toLowerCase() === 'path' &&
          (value.type === RegistryValueType.REG_SZ || value.type === RegistryValueType.REG_EXPAND_SZ)
      )
      return typeof pathValue?.data === 'string' ? pathValue.data : null
    }

    const systemPath = readPathValue(
      HKEY.HKEY_LOCAL_MACHINE,
      'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    )
    const userPath = readPathValue(HKEY.HKEY_CURRENT_USER, 'Environment')

    if (!systemPath && !userPath) {
      return null
    }

    const combined = [systemPath, userPath].filter(Boolean).join(';')
    return expandWindowsEnvVars(combined, env)
  } catch {
    return null
  }
}

/**
 * Build a fresh environment on Windows by copying `process.env` and replacing
 * PATH with the current registry value. This avoids the stale PATH problem
 * where `cmd.exe /c set` only inherits the Electron parent process's env.
 */
async function getWindowsEnvironment(): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  for (const key in process.env) {
    env[key] = process.env[key] || ''
  }

  const registryPath = await readWindowsRegistryPath(env)
  if (registryPath) {
    const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === 'path')
    for (const key of pathKeys) {
      env[key] = registryPath
    }
    if (pathKeys.length === 0) {
      env.Path = registryPath
    }
    logger.debug('Replaced PATH with fresh registry value')
  } else {
    logger.warn('Could not read PATH from Windows registry, keeping process.env PATH')
  }

  return env
}

/**
 * Spawns a login shell in the user's home directory to capture its environment variables.
 *
 * We explicitly run a login, non-interactive shell. This loads login profiles such as macOS
 * `~/.zprofile` (where Homebrew commonly installs its PATH) without executing interactive prompt,
 * theme, or terminal plugin setup from `~/.zshrc`.
 *
 * Timeout handling is important because profile scripts might block forever (e.g. misconfigured
 * `read` or prompts). We proactively kill the shell and surface an error in that case so that
 * the app does not hang.
 * @returns {Promise<Object>} A promise that resolves with an object containing
 * the environment variables, or rejects with an error.
 */
function getLoginShellEnvironment(): Promise<Record<string, string>> {
  // On Windows, skip the shell spawn entirely — `cmd.exe /c set` just inherits
  // the (potentially stale) parent process env. Instead, read the current PATH
  // straight from the Windows registry.
  if (isWin) {
    return getWindowsEnvironment()
  }

  return new Promise((resolve, reject) => {
    const homeDirectory =
      process.env.HOME ||
      process.env.Home ||
      process.env.USERPROFILE ||
      process.env.UserProfile ||
      application.getPath('sys.home')
    if (!homeDirectory) {
      return reject(new Error("Could not determine user's home directory."))
    }

    let shellPath = process.env.SHELL

    if (!shellPath) {
      if (isMac) {
        logger.warn(
          "process.env.SHELL is not set. Defaulting to /bin/zsh for macOS. This might not be the user's login shell."
        )
        shellPath = '/bin/zsh'
      } else {
        logger.warn("process.env.SHELL is not set. Defaulting to /bin/bash. This might not be the user's login shell.")
        shellPath = '/bin/bash'
      }
    }

    const commandArgs = ['-lc', 'env']

    logger.debug(`Spawning shell: ${shellPath} with args: ${commandArgs.join(' ')} in ${homeDirectory}`)

    let settled = false
    let timeoutId: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
    }

    const resolveOnce = (value: Record<string, string>) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }

    const rejectOnce = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    const child = spawn(shellPath, commandArgs, {
      cwd: homeDirectory, // Run the command in the user's home directory
      detached: false, // Stay attached so we can clean up reliably
      stdio: ['ignore', 'pipe', 'pipe'], // stdin, stdout, stderr
      shell: false // We are specifying the shell command directly
    })

    let output = ''
    let errorOutput = ''

    // Protects against shells that wait for user input or hang during profile sourcing.
    timeoutId = setTimeout(() => {
      const errorMessage = `Timed out after ${SHELL_ENV_TIMEOUT_MS}ms while retrieving shell environment. Shell: ${shellPath}. Args: ${commandArgs.join(
        ' '
      )}. CWD: ${homeDirectory}`
      logger.error(errorMessage)
      child.kill()
      rejectOnce(new Error(errorMessage))
    }, SHELL_ENV_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      output += data.toString()
    })

    child.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    child.on('error', (error) => {
      logger.error(`Failed to start shell process: ${shellPath}`, error)
      rejectOnce(new Error(`Failed to start shell: ${error.message}`))
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }

      if (code !== 0) {
        const errorMessage = `Shell process exited with code ${code}. Shell: ${shellPath}. Args: ${commandArgs.join(' ')}. CWD: ${homeDirectory}. Stderr: ${errorOutput.trim()}`
        logger.error(errorMessage)
        return rejectOnce(new Error(errorMessage))
      }

      if (errorOutput.trim()) {
        // Some shells might output warnings or non-fatal errors to stderr
        // during profile loading. Log it, but proceed if exit code is 0.
        logger.warn(`Shell process stderr output (even with exit code 0):\n${errorOutput.trim()}`)
      }

      // Convert each VAR=VALUE line into our env map.
      const env: Record<string, string> = {}
      const lines = output.split(/\r?\n/)

      lines.forEach((line) => {
        const trimmedLine = line.trim()
        if (trimmedLine) {
          const separatorIndex = trimmedLine.indexOf('=')
          if (separatorIndex > 0) {
            // Ensure '=' is present and it's not the first character
            const key = trimmedLine.substring(0, separatorIndex)
            const value = trimmedLine.substring(separatorIndex + 1)
            env[key] = value
          }
        }
      })

      if (Object.keys(env).length === 0 && output.length < 100) {
        // Arbitrary small length check
        // This might indicate an issue if no env vars were parsed or output was minimal
        logger.warn(
          'Parsed environment is empty or output was very short. This might indicate an issue with shell execution or environment variable retrieval.'
        )
        logger.warn(`Raw output from shell:\n${output}`)
      }

      resolveOnce(env)
    })
  })
}

let cachedEnv: Record<string, string> | null = null
let inflight: Promise<Record<string, string>> | null = null

async function fetchShellEnv(): Promise<Record<string, string>> {
  try {
    return await getLoginShellEnvironment()
  } catch (error) {
    logger.error('Failed to get shell environment, falling back to process.env', { error })
    const fallbackEnv: Record<string, string> = {}
    for (const key in process.env) {
      fallbackEnv[key] = process.env[key] || ''
    }
    return fallbackEnv
  }
}

/**
 * Fetch the shell env, collapsing concurrent callers onto a single spawn.
 *
 * Resolving the login shell can be slow or hang (misconfigured profiles), so
 * letting overlapping callers each spawn their own shell multiplies a 15s
 * timeout into several. Sharing the in-flight promise keeps it to one spawn.
 */
function loadShellEnv(): Promise<Record<string, string>> {
  if (inflight) {
    return inflight
  }
  // fetchShellEnv never rejects (it falls back to process.env), so the cache
  // is always populated and `inflight` always cleared.
  inflight = fetchShellEnv()
    .then((env) => {
      cachedEnv = env
      return env
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * Get the cached shell environment. If no cache exists yet, fetches it once.
 * This is a pure query -- it never invalidates the cache.
 *
 * Returns a shallow copy: callers routinely mutate the env they get back (e.g.
 * `removeEnvProxy`, merging per-spawn overrides), and handing out the cached
 * object itself would let one such mutation silently poison every later reader.
 */
export async function getRawShellEnv(): Promise<Record<string, string>> {
  const env = cachedEnv ?? (await loadShellEnv())
  return { ...env }
}

/**
 * Layer Cherry's managed-binary contract onto one raw shell snapshot: PATH
 * tails first, then the isolated MISE execution env. Deriving both the
 * ownership decision and the launch env from the same snapshot keeps MISE
 * ownership and PATH from mixing across cache refreshes — prefer this over
 * separate getShellEnv()/getRawShellEnv() reads for that.
 */
export function withCherryShellEnv(rawEnv: Record<string, string>): Record<string, string> {
  const env = { ...rawEnv }
  appendCherryToolDirsToPath(env)
  applyBinaryExecutionEnv(env)
  return env
}

export async function getShellEnv(): Promise<Record<string, string>> {
  return withCherryShellEnv(await getRawShellEnv())
}

/**
 * Invalidate the shell env cache and re-fetch the raw snapshot, without
 * layering Cherry's contract on top. Pair with withCherryShellEnv() when the
 * caller needs both the raw and the augmented view of one capture.
 */
export async function refreshRawShellEnv(): Promise<Record<string, string>> {
  if (inflight) {
    // Reusing a capture that started before the event prompting this refresh
    // (e.g. a tool install completing mid-flight). Acceptable because downstream
    // lookups hit the filesystem live; logged so the reuse is observable.
    logger.debug('refreshRawShellEnv reusing in-flight shell capture instead of re-spawning')
    return { ...(await inflight) }
  }
  cachedEnv = null
  return getRawShellEnv()
}

/**
 * Invalidate the shell env cache and immediately re-fetch a fresh environment.
 * This is an explicit command -- callers use this when they need to pick up
 * newly installed tools (nvm, mise, fnm, etc.) that change PATH.
 *
 * Returns a fresh shallow copy (see getShellEnv) so callers can use it directly
 * without a separate getShellEnv() call, avoiding stale-read race conditions.
 *
 * If a fetch is already in flight, that one is reused instead of spawning a
 * second shell -- it is already fresh enough, and a duplicate spawn just
 * multiplies the cost when the user's profile is slow.
 */
export async function refreshShellEnv(): Promise<Record<string, string>> {
  return withCherryShellEnv(await refreshRawShellEnv())
}
