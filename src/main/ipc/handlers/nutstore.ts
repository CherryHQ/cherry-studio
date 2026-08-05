import { createDirectory, getDirectoryContents, resolveNutstoreAccount } from '@main/services/nutstore/NutstoreService'
import type { nutstoreRequestSchemas } from '@shared/ipc/schemas/nutstore'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const nutstoreHandlers: IpcHandlersFor<typeof nutstoreRequestSchemas> = {
  'nutstore.get_account': async () => {
    const account = await resolveNutstoreAccount()
    // Only the display name leaves; the token that came with it stays here.
    return account ? { username: account.username } : null
  },

  'nutstore.list_directory': async ({ path }) => {
    const entries = await getDirectoryContents(path)
    return entries.map((entry) => ({
      path: entry.filename,
      basename: entry.basename,
      isDir: entry.type === 'directory',
      mtime: new Date(entry.lastmod).valueOf(),
      size: entry.size
    }))
  },

  'nutstore.create_directory': async ({ path }) => {
    await createDirectory(path)
  }
}
