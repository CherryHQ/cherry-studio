import { loggerService } from '@logger'
import type { GitBashPathInfo, GitBashPathSource } from '@shared/config/constant'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { isWin } from '../constant'
import { ConfigKeys, configManager } from '../services/ConfigManager'
import { getResourcePath } from '.'

const logger = loggerService.withContext('Utils:Process')

export function runInstallScript(scriptPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const installScriptPath = path.join(getResourcePath(), 'scripts', scriptPath)
    logger.info(`Running script at: ${installScriptPath}`)

    const nodeProcess = spawn(process.execPath, [installScriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })

    nodeProcess.stdout.on('data', (data) => {
      logger.debug(`Script output: ${data}`)
    })

    nodeProcess.stderr.on('data', (data) => {
      logger.error(`Script error: ${data}`)
    })

    nodeProcess.on('close', (code) => {
      if (code === 0) {
        logger.debug('Script completed successfully')
        resolve()
      } else {
        logger.warn(`Script exited with code ${code}`)
        reject(new Error(`Process exited with code ${code}`))
      }
    })
  })
}

export async function getBinaryName(name: string): Promise<string> {
  if (isWin) {
    return `${name}.exe`
  }
  return name
}

export async function getBinaryPath(name?: string): Promise<string> {
  if (!name) {
    return path.join(os.homedir(), HOME_CHERRY_DIR, 'bin')
  }

  const binaryName = await getBinaryName(name)
  const binariesDir = path.join(os.homedir(), HOME_CHERRY_DIR, 'bin')
  const binariesDirExists = fs.existsSync(binariesDir)
  return binariesDirExists ? path.join(binariesDir, binaryName) : binaryName
}

export async function isBinaryExists(name: string): Promise<boolean> {
  const cmd = await getBinaryPath(name)
  return fs.existsSync(cmd)
}

// Timeout for command lookup operations (in milliseconds)
const COMMAND_LOOKUP_TIMEOUT_MS = 5000

// Regex to validate command names - must start with alphanumeric or underscore, max 128 chars
const VALID_COMMAND_NAME_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,127}$/

// Maximum output size to prevent buffer overflow (10KB)
const MAX_OUTPUT_SIZE = 10240

/**
 * Check if a command is available in the user's login shell environment
 * @param command - Command name to check (e.g., 'npx', 'uvx')
 * @param loginShellEnv - The login shell environment from getLoginShellEnvironment()
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
            logger.debug(`Found command '${command}' at: ${exePath}`)
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
            logger.debug(`Found command '${command}' at: ${commandPath}`)
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

/**
 * Find executable in common paths or PATH environment variable
 * Based on Claude Code's implementation with security checks
 * @param name - Name of the executable to find (without .exe extension)
 * @returns Full path to the executable or null if not found
 */
export function findExecutable(name: string): string | null {
  // This implementation uses where.exe which is Windows-only
  if (!isWin) {
    return null
  }

  // Special handling for git - check common installation paths first
  if (name === 'git') {
    const commonGitPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe')
    ]

    for (const gitPath of commonGitPaths) {
      if (fs.existsSync(gitPath)) {
        logger.debug(`Found ${name} at common path`, { path: gitPath })
        return gitPath
      }
    }
  }

  // Use where.exe to find executable in PATH
  // Use execFileSync to prevent command injection
  try {
    // Add .exe extension for more precise matching on Windows
    const executableName = `${name}.exe`
    const result = execFileSync('where.exe', [executableName], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Handle both Windows (\r\n) and Unix (\n) line endings
    const paths = result.trim().split(/\r?\n/).filter(Boolean)
    const currentDir = process.cwd().toLowerCase()

    // Security check: skip executables in current directory
    for (const exePath of paths) {
      // Trim whitespace from where.exe output
      const cleanPath = exePath.trim()
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
  } catch (error) {
    logger.debug(`where.exe ${name} failed`, { error })
    return null
  }
}

/**
 * Find Git Bash executable on Windows
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

  // 3. Find git.exe and derive bash.exe path
  const gitPath = findExecutable('git')
  if (gitPath) {
    // Try multiple possible locations for bash.exe relative to git.exe
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

  // 4. Fallback: check common Git Bash paths directly
  const commonBashPaths = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')] : [])
  ]

  for (const bashPath of commonBashPaths) {
    if (fs.existsSync(bashPath)) {
      logger.debug('Found bash.exe at common path', { path: bashPath })
      return bashPath
    }
  }

  logger.debug('Git Bash not found - checked git derivation and common paths')
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
 * Auto-discover and persist Git Bash path if not already configured
 * Only called when Git Bash is actually needed
 *
 * Precedence order:
 * 1. CLAUDE_CODE_GIT_BASH_PATH environment variable (highest - runtime override)
 * 2. Configured path from settings (manual or auto)
 * 3. Auto-discovery via findGitBash (only if no valid config exists)
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

  // 2. Check if a path is already configured
  const existingPath = configManager.get<string | undefined>(ConfigKeys.GitBashPath)
  const existingSource = configManager.get<GitBashPathSource | undefined>(ConfigKeys.GitBashPathSource)

  if (existingPath) {
    const validated = validateGitBashPath(existingPath)
    if (validated) {
      return validated
    }
    // Existing path is invalid, try to auto-discover
    logger.warn('Existing Git Bash path is invalid, attempting auto-discovery', {
      path: existingPath,
      source: existingSource
    })
  }

  // 3. Try to find Git Bash via auto-discovery
  const discoveredPath = findGitBash()
  if (discoveredPath) {
    // Persist the discovered path with 'auto' source
    configManager.set(ConfigKeys.GitBashPath, discoveredPath)
    configManager.set(ConfigKeys.GitBashPathSource, 'auto')
    logger.info('Auto-discovered Git Bash path', { path: discoveredPath })
  }

  return discoveredPath
}

/**
 * Get Git Bash path info including source
 * If no path is configured, triggers auto-discovery first
 */
export function getGitBashPathInfo(): GitBashPathInfo {
  if (!isWin) {
    return { path: null, source: null }
  }

  let path = configManager.get<string | null>(ConfigKeys.GitBashPath) ?? null
  let source = configManager.get<GitBashPathSource | null>(ConfigKeys.GitBashPathSource) ?? null

  // If no path configured, trigger auto-discovery (handles upgrade from old versions)
  if (!path) {
    path = autoDiscoverGitBash()
    source = path ? 'auto' : null
  }

  return { path, source }
}
