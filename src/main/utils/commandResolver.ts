import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { getShellEnv } from './shellEnv'

/**
 * Resolution for arbitrary executables in the user's environment — locating
 * commands (npx, uvx, git, …) in the captured shell env, with Windows-specific
 * fallbacks (`where.exe`, mise) and Git Bash discovery. Distinct from
 * `binaryResolver.ts`, which resolves Cherry's own managed binaries.
 */

const logger = loggerService.withContext('Utils:CommandResolver')

// Timeout for command lookup operations (in milliseconds)
const COMMAND_LOOKUP_TIMEOUT_MS = 5000

// Regex to validate command names - must start with alphanumeric or underscore, max 128 chars
const VALID_COMMAND_NAME_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,127}$/

// Maximum output size to prevent buffer overflow (10KB)
const MAX_OUTPUT_SIZE = 10240

/**
 * Check if a command is available in the user's login shell environment
 * @param command - Command name to check (e.g., 'npx', 'uvx')
 * @param loginShellEnv - The login shell environment from getShellEnv()
 * @returns Full path to the command if found, null otherwise
 */
export async function findCommandInShellEnv(
  command: string,
  loginShellEnv: Record<string, string>
): Promise<string | null> {
  // Validate command name to prevent command injection
  if (!VALID_COMMAND_NAME_REGEX.test(command)) {
    logger.warn(`Invalid command name '${command}' - must only contain alphanumeric characters, underscore, or hyphen`)
    return null
  }

  return new Promise((resolve) => {
    let resolved = false

    const safeResolve = (value: string | null) => {
      if (resolved) return
      resolved = true
      resolve(value)
    }

    if (isWin) {
      // On Windows, use 'where' command
      const child = spawn('where', [command], {
        env: loginShellEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let output = ''
      const timeoutId = setTimeout(() => {
        if (resolved) return
        child.kill('SIGKILL')
        logger.debug(`Timeout checking command '${command}' on Windows`)
        safeResolve(null)
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
          const paths = output.trim().split(/\r?\n/)
          // Only accept .exe files on Windows - .cmd/.bat files cannot be executed
          // with spawn({ shell: false }) which is used by MCP SDK's StdioClientTransport
          const exePath = paths.find((p) => p.toLowerCase().endsWith('.exe'))
          if (exePath) {
            safeResolve(exePath)
          } else {
            logger.debug(`Command '${command}' found but not as .exe (${paths[0]}), treating as not found`)
            safeResolve(null)
          }
        } else {
          logger.debug(`Command '${command}' not found in shell environment`)
          safeResolve(null)
        }
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        if (resolved) return
        logger.warn(`Error checking command '${command}':`, { error, platform: 'windows' })
        safeResolve(null)
      })
    } else {
      // Unix/Linux/macOS: use 'command -v' which is POSIX standard
      // Use /bin/sh for reliability - it's POSIX compliant and always available
      // This avoids issues with user's custom shell (csh, fish, etc.)
      // SECURITY: Use positional parameter $1 to prevent command injection
      const child = spawn('/bin/sh', ['-c', 'command -v "$1"', '--', command], {
        env: loginShellEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let output = ''
      const timeoutId = setTimeout(() => {
        if (resolved) return
        child.kill('SIGKILL')
        logger.debug(`Timeout checking command '${command}'`)
        safeResolve(null)
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
        } else {
          logger.debug(`Command '${command}' not found in shell environment`)
          safeResolve(null)
        }
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        if (resolved) return
        logger.warn(`Error checking command '${command}':`, { error, platform: 'unix' })
        safeResolve(null)
      })
    }
  })
}

export interface FindExecutableOptions {
  /** File extensions to search for (default: ['.exe', '.cmd']) */
  extensions?: string[]
  /** Environment variables to use for where.exe lookup (default: process.env) */
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
  // This implementation uses where.exe which is Windows-only
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

  // Use where.exe to find executable in PATH
  // Use execFileSync to prevent command injection
  try {
    // Search without extension - where.exe returns all matches (npm, npm.cmd, npm.exe, etc.)
    // We then filter by allowed extensions below for security and precision
    const resultBuf = execFileSync('where.exe', [name], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options?.env
    })
    // where.exe output is file paths (ASCII-safe), decode as utf8
    const result = resultBuf.toString('utf8')

    // Handle both Windows (\r\n) and Unix (\n) line endings
    const paths = result.trim().split(/\r?\n/).filter(Boolean)
    const currentDir = process.cwd().toLowerCase()

    // Filter by allowed extensions
    for (const exePath of paths) {
      // Trim whitespace from where.exe output
      const cleanPath = exePath.trim()
      const lowerPath = cleanPath.toLowerCase()

      // Check if the file has an allowed extension
      const hasAllowedExtension = extensions.some((ext) => lowerPath.endsWith(ext.toLowerCase()))
      if (!hasAllowedExtension) {
        continue
      }

      const resolvedPath = path.resolve(cleanPath).toLowerCase()
      const execDir = path.dirname(resolvedPath).toLowerCase()

      // Skip if in current directory or subdirectory (potential malware)
      if (execDir === currentDir || execDir.startsWith(currentDir + path.sep)) {
        logger.warn('Skipping potentially malicious executable in current directory', {
          path: cleanPath
        })
        continue
      }

      logger.debug(`Found ${name} via where.exe`, { path: cleanPath })
      return cleanPath
    }

    return null
  } catch (error: unknown) {
    // On Chinese Windows, where.exe stderr is GBK-encoded and gets garbled as UTF-8.
    // Log only the exit code to avoid mojibake in logs.
    const code = error instanceof Error && 'status' in error ? (error as { status: unknown }).status : undefined
    logger.debug(`where.exe ${name} not found (exit code ${code})`)
    return null
  }
}

/** Timeout for mise operations (in milliseconds) */
const MISE_TIMEOUT_MS = 5000

/**
 * Find an executable via `mise which <name>` on Windows.
 *
 * When Node.js is installed through mise, the shims are `.cmd` files that
 * `findCommandInShellEnv` rejects (it only accepts `.exe`), and `mise activate`
 * may not be visible in the registry-based PATH used by `getWindowsEnvironment`.
 *
 * This function locates `mise.exe` via `where.exe` and asks it directly for
 * the real binary path, bypassing shim/PATH issues entirely.
 *
 * @param name - Tool name to resolve (e.g. 'node', 'npm')
 * @param env  - Environment variables for subprocess
 * @returns Absolute path to the real executable, or null
 */
export function findViaMise(name: string, env: Record<string, string>): string | null {
  if (!isWin) {
    return null
  }

  // Validate command name (reuse the same regex used by findCommandInShellEnv)
  if (!VALID_COMMAND_NAME_REGEX.test(name)) {
    return null
  }

  const misePath = findMiseExecutable(env)
  if (!misePath) {
    logger.debug('mise not found, skipping mise fallback')
    return null
  }

  try {
    const result = execFileSync(misePath, ['which', name], {
      encoding: 'utf8',
      timeout: MISE_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })

    const resolvedPath = result.trim().split(/\r?\n/)[0]?.trim()
    if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
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
    // Expected when the tool is not managed by mise, or mise times out
    logger.debug(`mise which ${name} failed`, { error })
    return null
  }
}

/**
 * Locate `mise.exe` on the local machine via `where.exe`.
 */
function findMiseExecutable(env: Record<string, string>): string | null {
  try {
    const resultBuf = execFileSync('where.exe', ['mise'], {
      timeout: MISE_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })
    const firstLine = resultBuf.toString('utf8').trim().split(/\r?\n/)[0]?.trim()
    if (firstLine && firstLine.toLowerCase().endsWith('.exe')) {
      return firstLine
    }
  } catch {
    // mise not on PATH
  }

  return null
}

/**
 * Find an executable in the user's shell environment.
 * This is a pure query -- it reads the (possibly cached) shell env and searches for the command.
 * It does NOT refresh the shell env cache. Callers that need a fresh environment should call
 * refreshShellEnv() explicitly before calling this function.
 *
 * Cross-platform: uses findCommandInShellEnv first, falls back to findExecutable on Windows,
 * and finally tries mise as a last resort on Windows.
 */
export async function findExecutableInEnv(name: string): Promise<string | null> {
  const env = await getShellEnv()

  // Cross-platform: try shell environment lookup first
  const found = await findCommandInShellEnv(name, env)
  if (found) {
    return found
  }

  // Windows fallback: findExecutable handles .cmd/.exe filtering and security checks
  if (isWin) {
    const winFound = findExecutable(name, { env })
    if (winFound) {
      return winFound
    }

    // Last resort on Windows: ask mise for the real binary path
    return findViaMise(name, env)
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

  const isExe = resolved.toLowerCase().endsWith('bash.exe')
  if (!isExe) {
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
