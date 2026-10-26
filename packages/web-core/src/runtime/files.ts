// Browser `@main/utils/file`: the path helpers and the async file helpers the agent host uses, on ZenFS.
// The rest (atomic writes, streams, downloads) needs Node streams; tool-output file storage stays unsupported.
import { lstat as fsLstat, mkdir as fsMkdir, realpath as fsRealpath, rm, stat as fsStat } from 'node:fs/promises'

import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

export { hashContent, PathStaleVersionError } from '../disabled/files'
export {
  canonicalizePathForContainment,
  isNotEmptyDir,
  isOutsidePath,
  isPathInside,
  isSameOrInside,
  resolvePath
} from '@main/utils/file/path'
export {
  createPathOverlapCheck,
  nearestExistingRealPathSync,
  type PathNameBehavior
} from '@main/utils/file/pathIdentity'
export { getPathStatus, type PathStatus, type PathStatusKind } from '@main/utils/file/pathStatus'

/** The desktop's check for a directory fsync the file system cannot do (`@main/utils/file/fs`, which needs Node streams). */
export function shouldSilenceFsyncDirError(code: string | undefined): boolean {
  return code === 'EINVAL' || code === 'EISDIR' || code === 'ENOTSUP'
}

export async function stat(path: AbsoluteFilePath) {
  const s = await fsStat(path)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory()
  }
}

export async function lstat(target: AbsoluteFilePath) {
  const s = await fsLstat(target)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory(),
    isFile: s.isFile(),
    isSymbolicLink: s.isSymbolicLink()
  }
}

export async function realpath(target: AbsoluteFilePath): Promise<AbsoluteFilePath> {
  return AbsoluteFilePathSchema.parse(await fsRealpath(target))
}

export async function mkdir(target: AbsoluteFilePath): Promise<void> {
  await fsMkdir(target)
}

export async function ensureDir(target: AbsoluteFilePath): Promise<void> {
  await fsMkdir(target, { recursive: true })
}

export async function removeDir(target: AbsoluteFilePath): Promise<void> {
  await rm(target, { recursive: true, force: true })
}
