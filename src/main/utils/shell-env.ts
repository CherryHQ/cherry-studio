import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { findGitBash } from '@main/utils/git-bash'
import { execFileSync, spawn } from 'child_process'

const logger = loggerService.withContext('ShellEnv')

// Give shells enough time to source profile files, but fail fast when they hang.
const SHELL_ENV_TIMEOUT_MS = 15_000

/**
 * Ensures the Cherry Studio bin directory is appended to the user's PATH while
 * preserving the original key casing and avoiding duplicate segments.
 */
const appendCherryBinToPath = (env: Record<string, string>) => {
  const pathSeparator = isWin ? ';' : ':'
  const homeDirFromEnv = env.HOME || env.Home || env.USERPROFILE || env.UserProfile || os.homedir()
  const cherryBinPath = path.join(homeDirFromEnv, '.cherrystudio', 'bin')
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
  const canonicalPathKey = pathKeys[0] || (isWin ? 'Path' : 'PATH')
  const existingPathValue = env[canonicalPathKey] || env.PATH || ''

  const normaliseSegment = (segment: string) => {
    const normalized = path.normalize(segment)
    return isWin ? normalized.toLowerCase() : normalized
  }

  const uniqueSegments: string[] = []
  const seenSegments = new Set<string>()
  const pushIfUnique = (segment: string) => {
    if (!segment) {
      return
    }
    const canonicalSegment = normaliseSegment(segment)
    if (!seenSegments.has(canonicalSegment)) {
      seenSegments.add(canonicalSegment)
      uniqueSegments.push(segment)
    }
  }

  existingPathValue
    .split(pathSeparator)
    .map((segment) => segment.trim())
    .forEach(pushIfUnique)

  pushIfUnique(cherryBinPath)

  const updatedPath = uniqueSegments.join(pathSeparator)

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

/**
 * Run `reg query <keyPath> /v <valueName>` and return the string data, or null on failure.
 */
function queryRegValue(keyPath: string, valueName: string): string | null {
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', valueName], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true
    })
    // Output format:
    //   HKEY_LOCAL_MACHINE\...\Environment
    //       Path    REG_EXPAND_SZ    C:\Windows;...
    const match = out.match(/REG_(?:EXPAND_)?SZ\s+(.*)/i)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
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
function readWindowsRegistryPath(env: Record<string, string>): string | null {
  const systemPath = queryRegValue('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path')
  const userPath = queryRegValue('HKCU\\Environment', 'Path')

  if (!systemPath && !userPath) {
    return null
  }

  const combined = [systemPath, userPath].filter(Boolean).join(';')
  return expandWindowsEnvVars(combined, env)
}

/**
 * Build a fresh environment on Windows by copying `process.env` and replacing
 * PATH with the current registry value. This avoids the stale PATH problem
 * where `cmd.exe /c set` only inherits the Electron parent process's env.
 */
function getWindowsEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key in process.env) {
    env[key] = process.env[key] || ''
  }

  const registryPath = readWindowsRegistryPath(env)
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

  appendCherryBinToPath(env)
  return env
}

/**
 * Merge registry PATH segments into a bash-captured environment.
 * Ensures Windows system-level paths (e.g. System32) are not lost
 * when the environment was captured from Git Bash.
 */
function mergeWithRegistryPath(env: Record<string, string>): Record<string, string> {
  const registryPath = readWindowsRegistryPath(env)
  if (!registryPath) {
    return { ...env }
  }

  // Find the PATH key in env (case-insensitive on Windows)
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path')
  const canonicalKey = pathKey || 'Path'
  const existingPath = env[canonicalKey] || ''

  const normaliseSegment = (segment: string) => path.normalize(segment).toLowerCase()
  const seenSegments = new Set(existingPath.split(';').map(normaliseSegment))

  const registrySegments = registryPath.split(';').filter((segment) => {
    const trimmed = segment.trim()
    if (!trimmed) return false
    const normalised = normaliseSegment(trimmed)
    if (seenSegments.has(normalised)) return false
    seenSegments.add(normalised)
    return true
  })

  if (registrySegments.length > 0) {
    return { ...env, [canonicalKey]: existingPath + ';' + registrySegments.join(';') }
  }

  return env
}

/**
 * Spawn a login shell and capture its environment variables.
 * Works with any POSIX-compatible shell (bash, zsh, etc.) on any platform.
 */
function spawnShellEnv(shellPath: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const homeDirectory =
      process.env.HOME || process.env.Home || process.env.USERPROFILE || process.env.UserProfile || os.homedir()
    if (!homeDirectory) {
      return reject(new Error("Could not determine user's home directory."))
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
      cwd: homeDirectory,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    })

    let output = ''
    let errorOutput = ''

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
        logger.warn(`Shell process stderr output (even with exit code 0):\n${errorOutput.trim()}`)
      }

      const env: Record<string, string> = {}
      const lines = output.split(/\r?\n/)

      lines.forEach((line) => {
        const trimmedLine = line.trim()
        if (trimmedLine) {
          const separatorIndex = trimmedLine.indexOf('=')
          if (separatorIndex > 0) {
            const key = trimmedLine.substring(0, separatorIndex)
            const value = trimmedLine.substring(separatorIndex + 1)
            env[key] = value
          }
        }
      })

      if (Object.keys(env).length === 0 && output.length < 100) {
        logger.warn(
          'Parsed environment is empty or output was very short. This might indicate an issue with shell execution or environment variable retrieval.'
        )
        logger.warn(`Raw output from shell:\n${output}`)
      }

      appendCherryBinToPath(env)

      resolveOnce(env)
    })
  })
}

/**
 * Detect the user's default shell on macOS/Linux.
 */
function detectUnixShell(): string {
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

  return shellPath
}

/**
 * Spawns a login shell in the user's home directory to capture its environment variables.
 *
 * On Windows with Git Bash installed, spawns bash.exe to source profile files.
 * On macOS/Linux, spawns the user's default login shell.
 * Falls back to registry-based PATH on Windows when Git Bash is unavailable or spawn fails.
 */
function getLoginShellEnvironment(): Promise<Record<string, string>> {
  // On Windows, try Git Bash first to source profile files
  if (isWin) {
    const gitBashPath = findGitBash()
    if (gitBashPath) {
      return spawnShellEnv(gitBashPath)
        .then((bashEnv) => mergeWithRegistryPath(bashEnv))
        .catch((error) => {
          logger.warn('Git Bash spawn failed, falling back to registry PATH', { error: error.message })
          return getWindowsEnvironment()
        })
    }
    // No Git Bash found — fallback to registry-based PATH
    return Promise.resolve(getWindowsEnvironment())
  }

  // macOS/Linux: spawn the user's default login shell
  const shellPath = detectUnixShell()
  return spawnShellEnv(shellPath)
}

let cachedEnv: Record<string, string> | null = null

async function fetchShellEnv(): Promise<Record<string, string>> {
  try {
    return await getLoginShellEnvironment()
  } catch (error) {
    logger.error('Failed to get shell environment, falling back to process.env', { error })
    // Fallback to current process environment with cherry studio bin path
    const fallbackEnv: Record<string, string> = {}
    for (const key in process.env) {
      fallbackEnv[key] = process.env[key] || ''
    }
    appendCherryBinToPath(fallbackEnv)
    return fallbackEnv
  }
}

/**
 * Get the cached shell environment. If no cache exists yet, fetches it once.
 * This is a pure query -- it never invalidates the cache.
 */
async function getShellEnv(): Promise<Record<string, string>> {
  if (!cachedEnv) {
    cachedEnv = await fetchShellEnv()
  }
  return cachedEnv
}

export default getShellEnv

/**
 * Invalidate the shell env cache and immediately re-fetch a fresh environment.
 * This is an explicit command -- callers use this when they need to pick up
 * newly installed tools (nvm, mise, fnm, etc.) that change PATH.
 *
 * Returns the fresh environment so callers can use it directly without a
 * separate getShellEnv() call, avoiding stale-read race conditions.
 */
export async function refreshShellEnv(): Promise<Record<string, string>> {
  cachedEnv = await fetchShellEnv()
  return cachedEnv
}
