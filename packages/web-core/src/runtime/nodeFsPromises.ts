// Browser `node:fs/promises`: ZenFS, whose `/web` mount holds the account's files (`mountAccountFiles`).
import * as zenfs from '@zenfs/core/emulation/compat.js'
import * as zenfsPromises from '@zenfs/core/promises'

export * from '@zenfs/core/promises'

/** ZenFS's async rename to a new path renames the file but then rejects with `ENOENT`; its sync rename does not. */
export async function rename(oldPath: string, newPath: string): Promise<void> {
  zenfs.renameSync(oldPath, newPath)
}

export const promises = { ...zenfsPromises, rename }

export default promises
