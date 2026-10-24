// Browser `node:fs/promises`: ZenFS, whose `/web` mount holds the account's files (`mountAccountFiles`).
import * as zenfs from '@zenfs/core/emulation/compat.js'
import * as zenfsPromises from '@zenfs/core/promises'

export * from '@zenfs/core/promises'

/**
 * ZenFS's async rename to a new path renames the file but then rejects with `ENOENT`; its sync rename
 * does not. A local folder has only async calls (`LocalFolderFS`).
 */
export async function rename(oldPath: string, newPath: string): Promise<void> {
  try {
    zenfs.renameSync(oldPath, newPath)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOTSUP') throw error
    await zenfsPromises.rename(oldPath, newPath)
  }
}

export const promises = { ...zenfsPromises, rename }

export default promises
