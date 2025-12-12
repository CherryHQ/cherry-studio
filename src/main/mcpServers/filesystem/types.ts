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
    const buffer = Buffer.alloc(4096)
    const fd = await fs.open(filePath, 'r')
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0)
    await fd.close()

    if (bytesRead === 0) return false

    const view = buffer.subarray(0, bytesRead)

    let zeroBytes = 0
    let evenZeros = 0
    let oddZeros = 0
    let nonPrintable = 0

    for (let i = 0; i < view.length; i++) {
      const b = view[i]

      if (b === 0) {
        zeroBytes++
        if (i % 2 === 0) evenZeros++
        else oddZeros++
        continue
      }

      // treat common whitespace as printable
      if (b === 9 || b === 10 || b === 13) continue

      // basic ASCII printable range
      if (b >= 32 && b <= 126) continue

      // bytes >= 128 are likely part of UTF-8 sequences; count as printable
      if (b >= 128) continue

      nonPrintable++
    }

    // If there are lots of null bytes, it's probably binary unless it looks like UTF-16 text.
    if (zeroBytes > 0) {
      const evenSlots = Math.ceil(view.length / 2)
      const oddSlots = Math.floor(view.length / 2)
      const evenZeroRatio = evenSlots > 0 ? evenZeros / evenSlots : 0
      const oddZeroRatio = oddSlots > 0 ? oddZeros / oddSlots : 0

      // UTF-16LE/BE tends to have zeros on every other byte.
      if (evenZeroRatio > 0.7 || oddZeroRatio > 0.7) return false

      if (zeroBytes / view.length > 0.05) return true
    }

    // Heuristic: too many non-printable bytes => binary.
    return nonPrintable / view.length > 0.3
  } catch {
    return false
  }
}
