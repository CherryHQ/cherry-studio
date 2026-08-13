import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/core/platform'
import { spawn } from 'child_process'

import { dedupePathSegments, getBinarySearchDirs, mergeBinaryExecutionEnv } from './binaryEnv'
import { getBundledGitDir } from './bundledGit'

const logger = loggerService.withContext('ShellEnv')

// Give shells enough time to source profile files, but fail fast when they hang.
const SHELL_ENV_TIMEOUT_MS = 15_000

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
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
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
 * We explicitly run a login + interactive shell so it sources the same init files that a user
 * would typically rely on inside their terminal. Many CLIs export PATH or other variables from
 * these scripts; capturing them keeps spawned processes aligned with the user’s expectations.
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

    const commandArgs = ['-ilc', 'env']

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

// Fresh capture: expiry drives re-resolution, so a PATH changed after launch
// (newly installed tool) reaches spawned processes without an app restart.
const SHELL_ENV_CACHE_KEY = 'system.shell_env'
// Last successful capture, never expired. Serves readers while a re-capture runs
// and survives a failed one, so a hung profile never downgrades a working env.
const SHELL_ENV_LAST_GOOD_KEY = 'system.shell_env.last_good'

// Windows resolves the env from a cheap registry read, so it can re-read at
// will; POSIX spawns a login shell and pays that at most once a minute.
const SHELL_ENV_TTL_MS = isWin ? 1_000 : 60_000

let inflight: Promise<Record<string, string>> | null = null

// Bumped by every explicit invalidation. A capture that started before the bump
// observed a pre-invalidation world, so it is discarded instead of published.
let generation = 0

function readProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key in process.env) {
    env[key] = process.env[key] || ''
  }
  return env
}

/**
 * Resolve the env once and publish it, unless a newer invalidation landed while
 * it was running. A failed capture keeps the last-known-good snapshot; only a
 * cold start (nothing captured yet) falls back to a bare `process.env`.
 */
async function captureShellEnv(startedAt: number): Promise<Record<string, string>> {
  const cache = application.get('CacheService')
  try {
    const env = await getLoginShellEnvironment()
    if (startedAt !== generation) {
      logger.debug('Discarding shell env capture superseded by an explicit refresh')
      return env
    }
    cache.set(SHELL_ENV_CACHE_KEY, env, SHELL_ENV_TTL_MS)
    cache.set(SHELL_ENV_LAST_GOOD_KEY, env)
    return env
  } catch (error) {
    logger.error('Failed to get shell environment', { error })
    const lastGood = cache.get<Record<string, string>>(SHELL_ENV_LAST_GOOD_KEY)
    if (lastGood) {
      return lastGood
    }
    // Cold start: cache the fallback so a hanging profile is not re-spawned on
    // every read, but never as last-known-good — it is a degraded env.
    const fallback = readProcessEnv()
    if (startedAt === generation) {
      cache.set(SHELL_ENV_CACHE_KEY, fallback, SHELL_ENV_TTL_MS)
    }
    return fallback
  }
}

/**
 * Run a capture, collapsing concurrent callers onto a single spawn.
 *
 * Resolving the login shell can be slow or hang (misconfigured profiles), so
 * letting overlapping callers each spawn their own shell multiplies a 15s
 * timeout into several. Sharing the in-flight promise keeps it to one spawn.
 *
 * `force` queues a capture that starts only after the running one settles: an
 * explicit refresh must observe the world as of its own call, and reusing an
 * older capture would report a pre-install PATH as current.
 */
function loadShellEnv(force = false): Promise<Record<string, string>> {
  if (inflight && !force) {
    return inflight
  }

  const startedAt = generation
  // captureShellEnv never rejects, so the chain and `inflight` always settle.
  const next: Promise<Record<string, string>> = inflight
    ? inflight.then(() => captureShellEnv(startedAt))
    : captureShellEnv(startedAt)
  inflight = next
  // A newer forced capture may already own the slot; only clear our own.
  const clear = () => {
    if (inflight === next) {
      inflight = null
    }
  }
  next.then(clear, clear)
  return next
}

/**
 * Get the shell environment, re-resolving it once the cached capture expires.
 * This is a pure query -- it never forces a refresh.
 *
 * On POSIX an expired capture is served stale while a shared re-capture runs in
 * the background, so a slow login shell never stalls a reader; only a cold start
 * with nothing captured waits. Windows re-resolves inline -- it is just a
 * registry read, and blocking on it keeps the value exact.
 *
 * Returns a shallow copy: callers routinely mutate the env they get back (e.g.
 * `removeEnvProxy`, merging per-spawn overrides), and handing out the cached
 * object itself would let one such mutation silently poison every later reader.
 */
export async function getRawShellEnv(): Promise<Record<string, string>> {
  const cache = application.get('CacheService')
  const cached = cache.get<Record<string, string>>(SHELL_ENV_CACHE_KEY)
  if (cached) {
    return { ...cached }
  }

  const lastGood = isWin ? undefined : cache.get<Record<string, string>>(SHELL_ENV_LAST_GOOD_KEY)
  if (lastGood) {
    // Background re-capture; a failure is logged inside and keeps this snapshot.
    void loadShellEnv().catch(() => {})
    return { ...lastGood }
  }
  return { ...(await loadShellEnv()) }
}

export async function getShellEnv(): Promise<Record<string, string>> {
  const env = await getRawShellEnv()
  appendCherryToolDirsToPath(env)
  applyBinaryExecutionEnv(env)
  return env
}

/**
 * Invalidate the shell env cache and immediately re-fetch a fresh environment.
 * This is an explicit command -- callers use this when they need to pick up
 * newly installed tools (nvm, mise, fnm, etc.) that change PATH.
 *
 * Returns a fresh shallow copy (see getShellEnv) so callers can use it directly
 * without a separate getShellEnv() call, avoiding stale-read race conditions.
 *
 * Always awaits a capture that starts after this call. A capture already running
 * may predate the install that prompted the refresh, so adopting it would report
 * the pre-install PATH -- and callers like BinaryManager use exactly this result
 * to decide whether a system tool is missing.
 */
export async function refreshShellEnv(): Promise<Record<string, string>> {
  generation++
  application.get('CacheService').delete(SHELL_ENV_CACHE_KEY)
  const env = { ...(await loadShellEnv(true)) }
  appendCherryToolDirsToPath(env)
  applyBinaryExecutionEnv(env)
  return env
}
