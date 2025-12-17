import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'

import { isPathInside } from './file'

const logger = loggerService.withContext('Utils:FileOperations')

const MAX_RECURSION_DEPTH = 1000

/**
 * Recursively copy a directory and all its contents
 * @param source - Source directory path (must be absolute)
 * @param destination - Destination directory path (must be absolute)
 * @param options - Copy options
 * @param depth - Current recursion depth (internal use)
 * @throws If copy operation fails or paths are invalid
 */
export async function copyDirectoryRecursive(
  source: string,
  destination: string,
  options?: { allowedBasePath?: string },
  depth = 0
): Promise<void> {
  // Input validation
  if (!source || !destination) {
    throw new TypeError('Source and destination paths are required')
  }

  if (!path.isAbsolute(source) || !path.isAbsolute(destination)) {
    throw new Error('Source and destination paths must be absolute')
  }

  // Depth limit to prevent stack overflow
  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(`Maximum recursion depth exceeded: ${MAX_RECURSION_DEPTH}`)
  }

  // Path validation - ensure operations stay within allowed boundaries
  if (options?.allowedBasePath) {
    if (!isPathInside(source, options.allowedBasePath)) {
      throw new Error(`Source path is outside allowed directory: ${source}`)
    }
    if (!isPathInside(destination, options.allowedBasePath)) {
      throw new Error(`Destination path is outside allowed directory: ${destination}`)
    }
  }

  try {
    // Verify source exists and is a directory
    const sourceStats = await fs.promises.lstat(source)
    if (!sourceStats.isDirectory()) {
      throw new Error(`Source is not a directory: ${source}`)
    }

    // Create destination directory
    await fs.promises.mkdir(destination, { recursive: true })
    logger.debug('Created destination directory', { destination })

    // Read source directory
    const entries = await fs.promises.readdir(source, { withFileTypes: true })

    // Copy each entry
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name)
      const destPath = path.join(destination, entry.name)

      // Use lstat to detect symlinks and prevent following them
      const entryStats = await fs.promises.lstat(sourcePath)

      if (entryStats.isSymbolicLink()) {
        logger.warn('Skipping symlink for security', { path: sourcePath })
        continue
      }

      if (entryStats.isDirectory()) {
        // Recursively copy subdirectory
        await copyDirectoryRecursive(sourcePath, destPath, options, depth + 1)
      } else if (entryStats.isFile()) {
        // Copy file with error handling for race conditions
        try {
          await fs.promises.copyFile(sourcePath, destPath)
          // Preserve file permissions
          await fs.promises.chmod(destPath, entryStats.mode)
          logger.debug('Copied file', { from: sourcePath, to: destPath })
        } catch (error) {
          // Handle race condition where file was deleted during copy
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            logger.warn('File disappeared during copy', { sourcePath })
            continue
          }
          throw error
        }
      } else {
        // Skip special files (pipes, sockets, devices, etc.)
        logger.debug('Skipping special file', { path: sourcePath })
      }
    }

    logger.info('Directory copied successfully', { from: source, to: destination, depth })
  } catch (error) {
    logger.error('Failed to copy directory', { source, destination, depth, error })
    throw error
  }
}

/**
 * Recursively delete a directory and all its contents
 * @param dirPath - Directory path to delete (must be absolute)
 * @param options - Delete options
 * @throws If deletion fails or path is invalid
 */
export async function deleteDirectoryRecursive(dirPath: string, options?: { allowedBasePath?: string }): Promise<void> {
  // Input validation
  if (!dirPath) {
    throw new TypeError('Directory path is required')
  }

  if (!path.isAbsolute(dirPath)) {
    throw new Error('Directory path must be absolute')
  }

  // Path validation - ensure operations stay within allowed boundaries
  if (options?.allowedBasePath) {
    if (!isPathInside(dirPath, options.allowedBasePath)) {
      throw new Error(`Path is outside allowed directory: ${dirPath}`)
    }
  }

  try {
    // Verify path exists before attempting deletion
    try {
      const stats = await fs.promises.lstat(dirPath)
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn('Directory already deleted', { dirPath })
        return
      }
      throw error
    }

    // Node.js 14.14+ has fs.rm with recursive option
    await fs.promises.rm(dirPath, { recursive: true, force: true })
    logger.info('Directory deleted successfully', { dirPath })
  } catch (error) {
    logger.error('Failed to delete directory', { dirPath, error })
    throw error
  }
}

/**
 * Get total size of a directory (in bytes)
 * @param dirPath - Directory path (must be absolute)
 * @param options - Size calculation options
 * @param depth - Current recursion depth (internal use)
 * @returns Total size in bytes
 * @throws If size calculation fails or path is invalid
 */
export async function getDirectorySize(
  dirPath: string,
  options?: { allowedBasePath?: string },
  depth = 0
): Promise<number> {
  // Input validation
  if (!dirPath) {
    throw new TypeError('Directory path is required')
  }

  if (!path.isAbsolute(dirPath)) {
    throw new Error('Directory path must be absolute')
  }

  // Depth limit to prevent stack overflow
  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(`Maximum recursion depth exceeded: ${MAX_RECURSION_DEPTH}`)
  }

  // Path validation - ensure operations stay within allowed boundaries
  if (options?.allowedBasePath) {
    if (!isPathInside(dirPath, options.allowedBasePath)) {
      throw new Error(`Path is outside allowed directory: ${dirPath}`)
    }
  }

  let totalSize = 0

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name)

      // Use lstat to detect symlinks and prevent following them
      const entryStats = await fs.promises.lstat(entryPath)

      if (entryStats.isSymbolicLink()) {
        logger.debug('Skipping symlink in size calculation', { path: entryPath })
        continue
      }

      if (entryStats.isDirectory()) {
        // Recursively get size of subdirectory
        totalSize += await getDirectorySize(entryPath, options, depth + 1)
      } else if (entryStats.isFile()) {
        // Get file size from lstat (already have it)
        totalSize += entryStats.size
      } else {
        // Skip special files
        logger.debug('Skipping special file in size calculation', { path: entryPath })
      }
    }

    logger.debug('Calculated directory size', { dirPath, size: totalSize, depth })
    return totalSize
  } catch (error) {
    logger.error('Failed to calculate directory size', { dirPath, depth, error })
    throw error
  }
}
