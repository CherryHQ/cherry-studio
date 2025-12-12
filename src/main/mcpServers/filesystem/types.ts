import { loggerService } from '@logger'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

export const logger = loggerService.withContext('MCP:FileSystemServer')

// Constants
export const MAX_LINE_LENGTH = 2000
export const DEFAULT_READ_LIMIT = 2000
export const MAX_FILES_LIMIT = 100
export const MAX_GREP_MATCHES = 100

// Common types
export interface FileInfo {
  path: string
  type: 'file' | 'directory'
  size?: number
  modified?: Date
}

export interface GrepMatch {
  file: string
  line: number
  content: string
}

// Utility functions for path handling
export function normalizePath(p: string): string {
  return path.normalize(p)
}

export function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1))
  }
  return filepath
}

// Security validation
export async function validatePath(allowedDirectories: string[] | undefined, requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath)
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath)

  const normalizedRequested = normalizePath(absolute)

  const hasAllowList = Array.isArray(allowedDirectories) && allowedDirectories.length > 0

  // Check if path is within allowed directories when allowlist is configured
  if (hasAllowList) {
    const isAllowed = allowedDirectories!.some((dir) => normalizedRequested.startsWith(dir))
    if (!isAllowed) {
      throw new Error(
        `Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories!.join(', ')}`
      )
    }
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute)
    const normalizedReal = normalizePath(realPath)
    if (hasAllowList) {
      const isRealPathAllowed = allowedDirectories!.some((dir) => normalizedReal.startsWith(dir))
      if (!isRealPathAllowed) {
        throw new Error('Access denied - symlink target outside allowed directories')
      }
    }
    return realPath
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute)
    try {
      const realParentPath = await fs.realpath(parentDir)
      const normalizedParent = normalizePath(realParentPath)
      if (hasAllowList) {
        const isParentAllowed = allowedDirectories!.some((dir) => normalizedParent.startsWith(dir))
        if (!isParentAllowed) {
          throw new Error('Access denied - parent directory outside allowed directories')
        }
      }
      return absolute
    } catch {
      // Path doesn't exist, but that's okay for some operations
      return absolute
    }
  }
}

// Check if a file is likely binary
export async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const buffer = Buffer.alloc(512)
    const fd = await fs.open(filePath, 'r')
    await fd.read(buffer, 0, 512, 0)
    await fd.close()

    // Check for null bytes (common in binary files)
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) return true
    }

    return false
  } catch {
    return false
  }
}
