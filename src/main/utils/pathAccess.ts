import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('Utils:PathAccess')

export function untildify(pathWithTilde: string): string {
  if (pathWithTilde.startsWith('~')) {
    return pathWithTilde.replace(/^~(?=$|\/|\\)/, os.homedir())
  }
  return pathWithTilde
}

export async function hasWritePermission(dir: string): Promise<boolean> {
  try {
    logger.info(`Checking write permission for ${dir}`)
    await fs.promises.access(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function isPathInside(childPath: string, parentPath: string): boolean {
  try {
    const normalizedChild = path.normalize(path.resolve(childPath))
    const normalizedParent = path.normalize(path.resolve(parentPath))
    if (normalizedChild === normalizedParent) return true

    const relativePath = path.relative(normalizedParent, normalizedChild)
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
  } catch (error) {
    logger.error('Failed to check path relationship:', error as Error)
    return false
  }
}
