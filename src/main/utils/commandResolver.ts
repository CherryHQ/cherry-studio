import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { execFile, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import which from 'which'

import { getBundledGitPath } from './bundledGit'
import { getPathFromEnvironment, getShellEnv } from './shellEnv'

/**
 * Resolution for arbitrary executables in the user's environment — locating
 * commands (npx, uvx, git, …) in the captured shell env, with Windows-specific
 * fallbacks (PATH/PATHEXT lookup, mise) and Git Bash discovery. Distinct from
 * `binaryResolver.ts`, which resolves Cherry's own managed binaries.
 */

const logger = loggerService.withContext('Utils:CommandResolver')
const execFileAsync = promisify(execFile)

// Timeout for command lookup operations (in milliseconds)
const COMMAND_LOOKUP_TIMEOUT_MS = 5000

// Regex to validate command names - must start with alphanumeric or underscore, max 128 chars
const VALID_COMMAND_NAME_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,127}$/

// Maximum output size to prevent buffer overflow (10KB)
const MAX_OUTPUT_SIZE = 10240

const WINDOWS_PATH_DELIMITER = ';'
const DEFAULT_WINDOWS_COMMAND_EXTENSIONS = ['.exe', '.cmd']

function toWindowsPathExt(extensions: string[]): string {
  return extensions
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`))
    .join(WINDOWS_PATH_DELIMITER)
}

function filterWindowsCommandCandidates(candidates: readonly string[], extensions: string[]): string[] {
  const allowedExtensions = new Set(
    extensions.map((extension) => (extension.startsWith('.') ? extension : `.${extension}`).toLowerCase())
  )
  const currentDirectory = path.win32.resolve(process.cwd()).toLowerCase()
  const seen = new Set<string>()
  const result: string[] = []

  for (const candidate of candidates) {
    const resolvedPath = path.win32.resolve(candidate.trim())
    const lowerPath = resolvedPath.toLowerCase()
    if (!allowedExtensions.has(path.win32.extname(lowerPath)) || seen.has(lowerPath)) {
      continue
    }

    const relativeToCurrentDirectory = path.win32.relative(currentDirectory, lowerPath)
    const isInCurrentDirectory =
      relativeToCurrentDirectory === '' ||
      (!relativeToCurrentDirectory.startsWith(`..${path.win32.sep}`) &&
        relativeToCurrentDirectory !== '..' &&
        !path.win32.isAbsolute(relativeToCurrentDirectory))
    if (isInCurrentDirectory) {
      logger.warn('Skipping potentially malicious executable in current directory', { path: resolvedPath })
      continue
    }

    seen.add(lowerPath)
    result.push(resolvedPath)
  }

  return result
}

async function findWindowsCommandCandidates(
  command: string,
  env: Record<string, string | undefined>,
  extensions: string[],
  signal?: AbortSignal
): Promise<string[]> {
  signal?.throwIfAborted()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<undefined>((resolve) => {
      timeoutId = setTimeout(() => resolve(undefined), COMMAND_LOOKUP_TIMEOUT_MS)
    })
    const candidates = await Promise.race([
      which(command, {
        all: true,
        delimiter: WINDOWS_PATH_DELIMITER,
        nothrow: true,
        path: getPathFromEnvironment(env) ?? '',
        pathExt: toWindowsPathExt(extensions)
      }),
      timeout
    ])
    signal?.throwIfAborted()
    if (candidates === undefined) {
      throw new Error(`Timed out resolving command '${command}' on Windows`)
    }
    return filterWindowsCommandCandidates(candidates ?? [], extensions)
  } catch (error) {
    logger.warn(`Error checking command '${command}'`, { error, platform: 'windows' })
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function findWindowsCommandCandidatesSync(
  command: string,
  env: Record<string, string | undefined>,
  extensions: string[]
): string[] {
  try {
    const candidates = which.sync(command, {
      all: true,
      delimiter: WINDOWS_PATH_DELIMITER,
      nothrow: true,
      path: getPathFromEnvironment(env) ?? '',
      pathExt: toWindowsPathExt(extensions)
    })
    return filterWindowsCommandCandidates(candidates ?? [], extensions)
  } catch (error) {
    logger.warn(`Error checking command '${command}'`, { error, platform: 'windows' })
    return []
  }
}

/** Absolute MCP stdio commands skip the bare-name regex and `command -v`. */
function resolveExistingAbsoluteCommand(command: string): string | null {
  const trimmed = command.trim()
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return null
  }

  const resolved = path.resolve(trimmed)
  if (!path.isAbsolute(resolved)) {
    return null
  }

  try {
    if (!fs.statSync(resolved).isFile()) {
      return null
    }
    fs.accessSync(resolved, isWin ? fs.constants.F_OK : fs.constants.X_OK)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }

  return resolved
}

/**
 * Check if a command is available in the user's login shell environment
 * @param command - Command name to check (e.g., 'npx', 'uvx')
 * @param loginShellEnv - The login shell environment from getShellEnv()
 * @returns Full path to the command if found, null otherwise
 */
export async function findCommandInShellEnv(
  command: string,
  loginShellEnv: Record<string, string>,
  signal?: AbortSignal
): Promise<string | null> {
  signal?.throwIfAborted()
  const absoluteCommand = resolveExistingAbsoluteCommand(command)
  if (absoluteCommand) {
    return absoluteCommand
  }

  // Validate command name to prevent command injection
  if (!VALID_COMMAND_NAME_REGEX.test(command)) {
    logger.warn(`Invalid command name '${command}' - must only contain alphanumeric characters, underscore, or hyphen`)
    return null
  }

  if (isWin) {
    const candidates = await findWindowsCommandCandidates(
      command,
      loginShellEnv,
      DEFAULT_WINDOWS_COMMAND_EXTENSIONS,
      signal
    )
    const exePath = candidates.find((candidate) => candidate.toLowerCase().endsWith('.exe'))
    const cmdPath = candidates.find((candidate) => candidate.toLowerCase().endsWith('.cmd'))
    const commandPath = exePath ?? cmdPath ?? null
    if (!commandPath) {
      logger.debug(`Command '${command}' not found in shell environment`)
    }
    return commandPath
  }

  return new Promise((resolve, reject) => {
    let resolved = false

    const safeResolve = (value: string | null) => {
      if (resolved) return
      resolved = true
      resolve(value)
    }

    // Unix/Linux/macOS: use 'command -v' which is POSIX standard
    // Use /bin/sh for reliability - it's POSIX compliant and always available
    // This avoids issues with user's custom shell (csh, fish, etc.)
    // SECURITY: Use positional parameter $1 to prevent command injection
    const child = spawn('/bin/sh', ['-c', 'command -v "$1"', '--', command], {
      env: loginShellEnv,
      signal,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    const timeoutId = setTimeout(() => {
      if (resolved) return
      child.kill('SIGKILL')
      logger.debug(`Timeout checking command '${command}'`)
      resolved = true
      reject(new Error(`Timed out resolving command '${command}'`))
    }, COMMAND_LOOKUP_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      if (output.length < MAX_OUTPUT_SIZE) {
        output += data.toString()
      }
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      if (resolved) return

      if (code === 0 && output.trim()) {
        const commandPath = output.trim().split('\n')[0]

        // Validate the output is an absolute path (not an alias, function, or builtin)
        // command -v can return just the command name for aliases/builtins
        if (path.isAbsolute(commandPath)) {
          safeResolve(commandPath)
        } else {
          logger.debug(`Command '${command}' resolved to non-path '${commandPath}', treating as not found`)
          safeResolve(null)
        }
      } else if (code === 1 || code === 0) {
        logger.debug(`Command '${command}' not found in shell environment`)
        safeResolve(null)
      } else {
        resolved = true
        reject(new Error(`Command lookup exited with code ${code}`))
      }
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      if (resolved) return
      logger.warn(`Error checking command '${command}':`, { error, platform: 'unix' })
      resolved = true
      reject(error)
    })
  })
}

export interface FindExecutableOptions {
  /** File extensions to search for (default: ['.exe', '.cmd']) */
  extensions?: string[]
  /** Environment variables to use for Windows PATH lookup (default: process.env) */
  env?: Record<string, string>
}

/**
 * Find executable in common paths or PATH environment variable
 * Based on Claude Code's implementation with security checks
 * @param name - Name of the executable to find (without extension)
 * @param options - Optional configuration for extensions and common paths
 * @returns Full path to the executable or null if not found
 */
export function findExecutable(name: string, options?: FindExecutableOptions): string | null {
  // This implementation is Windows-only
  if (!isWin) {
    return null
  }

  const extensions = options?.extensions ?? ['.exe', '.cmd']

  // Special handling for git - check common installation paths first
  // Uses getCommonGitRoots() which includes ProgramFiles, ProgramFiles(x86), and LOCALAPPDATA
  if (name === 'git') {
    for (const root of getCommonGitRoots()) {
      const gitPath = path.join(root, 'cmd', 'git.exe')
      if (fs.existsSync(gitPath)) {
        logger.debug(`Found ${name} at common path`, { path: gitPath })
        return gitPath
      }
    }
  }

  const candidates = findWindowsCommandCandidatesSync(name, options?.env ?? process.env, extensions)
  const commandPath = candidates[0] ?? null
  if (commandPath) {
    logger.debug(`Found ${name} in PATH`, { path: commandPath })
  }
  return commandPath
}

/** Timeout for mise operations (in milliseconds) */
const MISE_TIMEOUT_MS = 5000

/**
 * Find an executable via `mise which <name>` on Windows.
 *
 * When Node.js is installed through mise, resolving the real binary avoids
 * depending on a shim that may not be visible in the registry-based PATH used
 * by `getWindowsEnvironment`.
 *
 * This function locates `mise.exe` in PATH and asks it directly for the real
 * binary path, bypassing shim/PATH issues entirely.
 *
 * @param name - Tool name to resolve (e.g. 'node', 'npm')
 * @param env  - Environment variables for subprocess
 * @returns Absolute path to the real executable, or null
 */
export async function findViaMise(
  name: string,
  env: Record<string, string>,
  signal?: AbortSignal
): Promise<string | null> {
  signal?.throwIfAborted()
  if (!isWin) {
    return null
  }

  // Validate command name (reuse the same regex used by findCommandInShellEnv)
  if (!VALID_COMMAND_NAME_REGEX.test(name)) {
    return null
  }

  const misePath = await findMiseExecutable(env, signal)
  if (!misePath) {
    logger.debug('mise not found, skipping mise fallback')
    return null
  }

  try {
    const { stdout: result } = await execFileAsync(misePath, ['which', name], {
      encoding: 'utf8',
      timeout: MISE_TIMEOUT_MS,
      signal,
      killSignal: 'SIGKILL',
      env
    })

    const resolvedPath = result.trim().split(/\r?\n/)[0]?.trim()
    if (!resolvedPath || !path.win32.isAbsolute(resolvedPath)) {
      logger.debug(`mise which ${name} returned non-absolute path: ${resolvedPath}`)
      return null
    }

    if (!fs.existsSync(resolvedPath)) {
      logger.debug(`mise which ${name} returned non-existent path: ${resolvedPath}`)
      return null
    }

    logger.debug(`Found ${name} via mise`, { path: resolvedPath })
    return resolvedPath
  } catch (error) {
    signal?.throwIfAborted()
    if ((error as { code?: unknown }).code === 1) return null
    throw error
  }
}

/**
 * Locate `mise.exe` on the local machine through the bounded, Unicode-safe PATH resolver.
 */
export async function findMiseExecutable(
  env: Record<string, string | undefined> = process.env,
  signal?: AbortSignal
): Promise<string | null> {
  return (await findWindowsCommandCandidates('mise', env, ['.exe'], signal))[0] ?? null
}

/**
 * Find an executable in the user's shell environment.
 * This is a pure query -- it reads the (possibly cached) shell env and searches for the command.
 * It does NOT refresh the shell env cache. Callers that need a fresh environment should call
 * refreshShellEnv() explicitly before calling this function.
 *
 * Cross-platform: uses findCommandInShellEnv first, falls back to findExecutable on Windows,
 * then mise, and finally (for `git` only) the bundled MinGit as the last resort.
 */
export async function findExecutableInEnv(
  name: string,
  options: { env?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<string | null> {
  const { signal } = options
  signal?.throwIfAborted()
  const env = options.env ?? (await getShellEnv(signal))

  // The bundled MinGit dir sits on the PATH tail (see shellEnv), so ordinary
  // PATH lookup can surface it before the system/mise fallbacks run. Treat such
  // hits as provisional and return the bundle only after every external source
  // misses, preserving its last-resort priority.
  const bundledGit = name === 'git' ? getBundledGitPath() : null
  const isBundledGit = (p: string) => bundledGit !== null && p.toLowerCase() === bundledGit.toLowerCase()

  // Cross-platform: try shell environment lookup first
  const found = await findCommandInShellEnv(name, env, signal)
  if (found && !isBundledGit(found)) {
    return found
  }

  // Windows fallback: findExecutable handles .cmd/.exe filtering and security checks
  if (isWin) {
    const winFound = findExecutable(name, { env })
    if (winFound && !isBundledGit(winFound)) {
      return winFound
    }

    // Ask mise for the real binary path
    const viaMise = await findViaMise(name, env, signal)
    if (viaMise) {
      return viaMise
    }

    // Last resort: the bundled MinGit shipped with the app, so git works even
    // when the user has no system git installed. System/mise git always win above.
    return bundledGit
  }

  return null
}

/**
 * Common Git installation root directories on Windows
 * Used by findExecutable() (git special case) and findGitBash() to check fallback paths
 */
function getCommonGitRoots(): string[] {
  return [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git'),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Git')] : [])
  ]
}

/**
 * Find Git Bash (bash.exe) on Windows
 * @param customPath - Optional custom path from config
 * @returns Full path to bash.exe or null if not found
 */
export function findGitBash(customPath?: string | null): string | null {
  // Git Bash is Windows-only
  if (!isWin) {
    return null
  }

  // 1. Check custom path from config first
  if (customPath) {
    const validated = validateGitBashPath(customPath)
    if (validated) {
      logger.debug('Using custom Git Bash path from config', { path: validated })
      return validated
    }
    logger.warn('Custom Git Bash path provided but invalid', { path: customPath })
  }

  // 2. Check environment variable override
  const envOverride = process.env.CLAUDE_CODE_GIT_BASH_PATH
  if (envOverride) {
    const validated = validateGitBashPath(envOverride)
    if (validated) {
      logger.debug('Using CLAUDE_CODE_GIT_BASH_PATH override for bash.exe', { path: validated })
      return validated
    }
    logger.warn('CLAUDE_CODE_GIT_BASH_PATH provided but path is invalid', { path: envOverride })
  }

  // 3. Find git.exe via findExecutable (checks PATH + common Git install paths)
  const gitPath = findExecutable('git')
  if (gitPath) {
    // Derive bash.exe from git.exe location
    // Different Git installations have different directory structures
    const possibleBashPaths = [
      path.join(gitPath, '..', '..', 'bin', 'bash.exe'), // Standard Git: git.exe at Git/cmd/ -> navigate up 2 levels -> then bin/bash.exe
      path.join(gitPath, '..', 'bash.exe'), // Portable Git: git.exe at Git/bin/ -> bash.exe in same directory
      path.join(gitPath, '..', '..', 'usr', 'bin', 'bash.exe') // MSYS2 Git: git.exe at msys64/usr/bin/ -> navigate up 2 levels -> then usr/bin/bash.exe
    ]

    for (const bashPath of possibleBashPaths) {
      const resolvedBashPath = path.resolve(bashPath)
      if (fs.existsSync(resolvedBashPath)) {
        logger.debug('Found bash.exe via git.exe path derivation', { path: resolvedBashPath })
        return resolvedBashPath
      }
    }

    logger.debug('bash.exe not found at expected locations relative to git.exe', {
      gitPath,
      checkedPaths: possibleBashPaths.map((p) => path.resolve(p))
    })
  }

  // 4. Fallback: check common Git installation paths directly
  for (const root of getCommonGitRoots()) {
    const fullPath = path.join(root, 'bin', 'bash.exe')
    if (fs.existsSync(fullPath)) {
      logger.debug('Found bash.exe at common path', { path: fullPath })
      return fullPath
    }
  }

  logger.debug('bash.exe not found - checked git derivation and common paths')
  return null
}

export function validateGitBashPath(customPath?: string | null): string | null {
  if (!customPath) {
    return null
  }

  const resolved = path.resolve(customPath)

  if (!fs.existsSync(resolved)) {
    logger.warn('Custom Git Bash path does not exist', { path: resolved })
    return null
  }

  const executableName = path.basename(resolved).toLowerCase()
  if (executableName !== 'bash.exe') {
    logger.warn('Custom Git Bash path is not bash.exe', { path: resolved })
    return null
  }

  logger.debug('Validated custom Git Bash path', { path: resolved })
  return resolved
}

/**
 * Resolve the Git Bash (bash.exe) path for the Claude Code runtime on Windows.
 * Pure in-process discovery — not persisted (Git Bash has no UI/IPC surface, so
 * there is no user-configured value to store; the env var is the manual override).
 *
 * Precedence order:
 * 1. CLAUDE_CODE_GIT_BASH_PATH environment variable (runtime override)
 * 2. Auto-discovery via findGitBash
 */
export function autoDiscoverGitBash(): string | null {
  if (!isWin) {
    return null
  }

  // 1. Check environment variable override first (highest priority)
  const envOverride = process.env.CLAUDE_CODE_GIT_BASH_PATH
  if (envOverride) {
    const validated = validateGitBashPath(envOverride)
    if (validated) {
      logger.debug('Using CLAUDE_CODE_GIT_BASH_PATH override', { path: validated })
      return validated
    }
    logger.warn('CLAUDE_CODE_GIT_BASH_PATH provided but path is invalid', { path: envOverride })
  }

  // 2. Auto-discovery
  const discoveredPath = findGitBash()
  if (discoveredPath) {
    logger.debug('Auto-discovered Git Bash path', { path: discoveredPath })
  }
  return discoveredPath
}
