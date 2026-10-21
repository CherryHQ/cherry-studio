import { resolveMountConfig, vfs } from '@zenfs/core'
import { WebAccess } from '@zenfs/dom'

/** Where `application.getPath` places every path, and so every file the desktop services touch. */
const FILES_ROOT = '/web'

let mounted = false

/**
 * Mounts the account's file directory on OPFS at `/web`, next to its database. ZenFS copies the
 * directory into memory on mount, so the desktop's sync `fs` calls work; async writes reach OPFS
 * before they resolve.
 */
export async function mountAccountFiles(account: string): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const accounts = await root.getDirectoryHandle('cherry-studio', { create: true })
  const accountDirectory = await accounts.getDirectoryHandle(encodeURIComponent(account), { create: true })
  const handle = await accountDirectory.getDirectoryHandle('files', { create: true })
  vfs.mount(FILES_ROOT, await resolveMountConfig({ backend: WebAccess, handle }))
  mounted = true
}

export function unmountAccountFiles(): void {
  if (!mounted) return
  vfs.umount(FILES_ROOT)
  mounted = false
}
