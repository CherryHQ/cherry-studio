import fs from 'fs/promises'
import os from 'os'
import path from 'path'

// Normalize all paths consistently
export function normalizePath(p: string): string {
  return path.normalize(p)
}

export function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1))
  }
  return filepath
}

// Security utilities
export async function validatePath(allowedDirectories: string[], requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath)
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath)

  const normalizedRequested = normalizePath(absolute)

  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some((dir) => normalizedRequested.startsWith(dir))
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`
    )
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute)
    const normalizedReal = normalizePath(realPath)
    const isRealPathAllowed = allowedDirectories.some((dir) => normalizedReal.startsWith(dir))
    if (!isRealPathAllowed) {
      throw new Error('Access denied - symlink target outside allowed directories')
    }
    return realPath
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute)
    try {
      const realParentPath = await fs.realpath(parentDir)
      const normalizedParent = normalizePath(realParentPath)
      const isParentAllowed = allowedDirectories.some((dir) => normalizedParent.startsWith(dir))
      if (!isParentAllowed) {
        throw new Error('Access denied - parent directory outside allowed directories')
      }
      return absolute
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`)
    }
  }
}

export async function validateAllowedDirectories(dirs: string[]): Promise<void> {
  if (!Array.isArray(dirs) || dirs.length === 0) {
    throw new Error('No allowed directories provided, please specify at least one directory')
  }

  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const stats = await fs.stat(expandHome(dir))
        if (!stats.isDirectory()) {
          throw new Error(`${dir} is not a directory`)
        }
      } catch (error: any) {
        throw new Error(`Error accessing directory ${dir}: ${error.message}`)
      }
    })
  )
}
