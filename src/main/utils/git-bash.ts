import { loggerService } from '@logger'
import type { GitBashPathInfo, GitBashPathSource } from '@shared/config/constant'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import { isWin } from '../constant'
import { ConfigKeys, configManager } from '../services/ConfigManager'

const logger = loggerService.withContext('Process')

// Re-export for process.ts which also uses this for findExecutable('git')
export function getCommonGitRoots(): string[] {
  return [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git'),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Git')] : [])
  ]
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
 * Find git.exe on Windows via where.exe (no dependency on process.ts).
 * Returns the first match or null.
 */
function findGitExeViaWhere(): string | null {
  try {
    const output = execFileSync('where', ['git'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true
    })
    const firstLine = output.trim().split(/\r?\n/)[0]
    return firstLine && fs.existsSync(firstLine) ? firstLine : null
  } catch {
    return null
  }
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

  // 3. Find git.exe via where.exe, derive bash.exe path
  const gitPath = findGitExeViaWhere()
  if (gitPath) {
    const possibleBashPaths = [
      path.join(gitPath, '..', '..', 'bin', 'bash.exe'),
      path.join(gitPath, '..', 'bash.exe'),
      path.join(gitPath, '..', '..', 'usr', 'bin', 'bash.exe')
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
