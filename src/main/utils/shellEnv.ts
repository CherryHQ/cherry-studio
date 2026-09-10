import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/core/platform'
import { spawn } from 'child_process'

import { dedupePathSegments, getBinarySearchDirs, mergeBinaryExecutionEnv } from './binaryEnv'
import { getBundledGitDir } from './bundledGit'

const logger = loggerService.withContext('ShellEnv')

// Give shells enough time to source profile files, but fail fast when they hang.
const SHELL_ENV_TIMEOUT_MS = 15_000

/** Read PATH using Windows-compatible, case-insensitive environment-key semantics. */
export function getPathFromEnvironment(env: Record<string, string | undefined>): string | undefined {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
  return pathKey ? env[pathKey] : undefined
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
 *
 * Throws when the registry is unreadable: `process.env` alone is the boot-time
 * PATH, i.e. exactly the stale value this function exists to replace. Reporting
 * it as a capture would record it as last-known-good and hide the failure.
 */
async function getWindowsEnvironment(): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  for (const key in process.env) {
    env[key] = process.env[key] || ''
  }

  const registryPath = await readWindowsRegistryPath(env)
  if (!registryPath) {
    throw new Error('Could not read PATH from the Windows registry')
  }

  const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === 'path')
  for (const key of pathKeys) {
    env[key] = registryPath
  }
  if (pathKeys.length === 0) {
    env.Path = registryPath
  }
  logger.debug('Replaced PATH with fresh registry value')

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

// Fresh capture: expiry drives re-resolution, so a PATH changed after launch
// (newly installed tool) reaches spawned processes without an app restart.
const SHELL_ENV_CACHE_KEY = 'system.shell_env'
// Last successful capture, never expired. Serves readers while a re-capture runs
// and survives a failed one, so a hung profile never downgrades a working env.
const SHELL_ENV_LAST_GOOD_KEY = 'system.shell_env.last_good'

// Backstop only: a caller that must observe a tool the user just installed asks
// for a fresh capture. This just bounds how stale a passive read can get, so it
// is platform-agnostic -- the cost difference between a registry read and a
// login-shell spawn says what each platform can afford, not what it needs.
const SHELL_ENV_TTL_MS = 5 * 60_000

let inflight: Promise<Record<string, string>> | null = null
// Captures that have begun, counted rather than timestamped: a caller and a
// capture that fall in the same millisecond must still order, and a clock can
// only report them as simultaneous.
let capturesStarted = 0
// Index of `inflight`, or Infinity while it is still queued behind an earlier
// capture -- it is then guaranteed to start later than any caller deciding right
// now whether to join it.
let inflightCapture = 0

function readProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key in process.env) {
    env[key] = process.env[key] || ''
  }
  return env
}

/**
 * Resolve the env once and publish it. A failed capture republishes the
 * last-known-good snapshot for one TTL: a broken profile must not be re-spawned
 * on every read. Only a cold start falls back to a bare `process.env`, and never
 * as last-known-good -- it is a degraded env, not a capture.
 */
async function captureShellEnv(): Promise<Record<string, string>> {
  const cache = application.get('CacheService')
  try {
    const env = await getLoginShellEnvironment()
    cache.set(SHELL_ENV_CACHE_KEY, env, SHELL_ENV_TTL_MS)
    cache.set(SHELL_ENV_LAST_GOOD_KEY, env)
    return env
  } catch (error) {
    logger.error('Failed to get shell environment', { error })
    const fallback = cache.get<Record<string, string>>(SHELL_ENV_LAST_GOOD_KEY) ?? readProcessEnv()
    cache.set(SHELL_ENV_CACHE_KEY, fallback, SHELL_ENV_TTL_MS)
    return fallback
  }
}

/**
 * Run a capture, collapsing callers onto as few spawns as the freshness they ask
 * for allows. `minCapture` is the lowest capture index that satisfies the
 * caller: `0` accepts any capture, `capturesStarted + 1` accepts only one that
 * begins after this call.
 *
 * Resolving the login shell can be slow or hang (misconfigured profiles), so a
 * capture that cannot be joined is queued behind the running one rather than
 * spawned alongside it -- overlapping shells would multiply the 15s timeout.
 * While queued it satisfies every caller, so a burst still costs one extra
 * capture, not one per caller.
 */
function loadShellEnv(minCapture = 0): Promise<Record<string, string>> {
  if (inflight && inflightCapture >= minCapture) {
    return inflight
  }

  const previous = inflight
  inflightCapture = Number.POSITIVE_INFINITY
  const start = () => {
    inflightCapture = ++capturesStarted
    return captureShellEnv()
  }
  // captureShellEnv never rejects, so the chain and `inflight` always settle.
  const next: Promise<Record<string, string>> = previous ? previous.then(start, start) : start()
  inflight = next
  // A later capture may already own the slot; only clear our own.
  const clear = () => {
    if (inflight === next) {
      inflight = null
    }
  }
  next.then(clear, clear)
  return next
}

/**
 * Get the shell environment.
 *
 * Pass `fresh` when the result decides something the user just changed outside
 * the app -- activating an MCP server against a tool they installed a minute
 * ago, probing whether a CLI is present. It awaits a capture that started after
 * the call, which costs a login-shell spawn on POSIX.
 *
 * A passive read is served from the cache, and an expired one is served stale
 * while a shared re-capture runs in the background, so a slow login shell never
 * stalls a reader; only a cold start with nothing captured waits.
 *
 * Returns a shallow copy: callers routinely mutate the env they get back (e.g.
 * `removeEnvProxy`, merging per-spawn overrides), and handing out the cached
 * object itself would let one such mutation silently poison every later reader.
 */
export async function getRawShellEnv(options?: { fresh?: boolean }): Promise<Record<string, string>> {
  if (options?.fresh) {
    return { ...(await loadShellEnv(capturesStarted + 1)) }
  }

  const cache = application.get('CacheService')
  const cached = cache.get<Record<string, string>>(SHELL_ENV_CACHE_KEY)
  if (cached) {
    return { ...cached }
  }

  const lastGood = cache.get<Record<string, string>>(SHELL_ENV_LAST_GOOD_KEY)
  if (lastGood) {
    // Background re-capture; a failure is logged inside and keeps this snapshot.
    void loadShellEnv().catch(() => {})
    return { ...lastGood }
  }
  return { ...(await loadShellEnv()) }
}

export async function getShellEnv(options?: { fresh?: boolean }): Promise<Record<string, string>> {
  const env = await getRawShellEnv(options)
  appendCherryToolDirsToPath(env)
  applyBinaryExecutionEnv(env)
  return env
}

/**
 * Re-capture the environment and return it. Callers use this when they need to
 * pick up newly installed tools (nvm, mise, fnm, etc.) that change PATH.
 *
 * Always awaits a capture that starts after this call: one already running may
 * predate the install that prompted the refresh, so adopting it would report the
 * pre-install PATH -- and callers like BinaryManager use exactly this result to
 * decide whether a system tool is missing.
 */
export function refreshShellEnv(): Promise<Record<string, string>> {
  return getShellEnv({ fresh: true })
}
