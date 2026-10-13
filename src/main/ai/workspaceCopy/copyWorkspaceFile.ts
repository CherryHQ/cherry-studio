import { constants } from 'node:fs'
import { copyFile, lstat } from 'node:fs/promises'
import path from 'node:path'

import type * as NativeCopyFile from '@vscode/fs-copyfile'

import { loggerService } from '@logger'

import { WorkspaceCopyError, fileErrorCode } from './WorkspaceCopyError'

const logger = loggerService.withContext('WorkspaceCopyFile')
const unsupported = new Set(['EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'])
let nativeModule: Promise<typeof NativeCopyFile | undefined> | undefined

function loadNative() {
  return (nativeModule ??= import('@vscode/fs-copyfile').catch((error: unknown) => {
    logger.warn('Native workspace cloning is unavailable', { error })
    return undefined
  }))
}

export async function copyWorkspaceFile(
  source: string,
  target: string
): Promise<{
  method: 'cloned' | 'copied'
  fallbackReason?: string
}> {
  let fallbackReason: string
  // 3.0.0 uses GetTempFileNameW's MAX_PATH-sized buffer for its Windows staging file.
  if (process.platform === 'win32' && (source.length >= 260 || path.dirname(target).length > 246)) {
    fallbackReason = 'windows_path_limit'
  } else {
    const native = await loadNative()
    if (native) {
      try {
        await native.copyFile(source, target, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL)
        return { method: 'cloned' }
      } catch (error) {
        const code = fileErrorCode(error)
        if (!code || !unsupported.has(code)) throw error
        fallbackReason = code
      }
    } else {
      fallbackReason = 'native_unavailable'
    }
  }
  const existing = await lstat(target).catch((error: unknown) => {
    if (fileErrorCode(error) !== 'ENOENT') throw error
    return undefined
  })
  if (existing) throw new WorkspaceCopyError('path_collision', 'copy')
  await copyFile(source, target, constants.COPYFILE_EXCL)
  return { method: 'copied', fallbackReason }
}
