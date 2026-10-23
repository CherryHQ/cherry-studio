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
  await mountOpfsDirectory(FILES_ROOT, ['cherry-studio', encodeURIComponent(account), 'files'])
  mounted = true
}

/** Mounts the OPFS directory at `segments` (created if missing) at `mountPoint` in ZenFS. */
export async function mountOpfsDirectory(mountPoint: string, segments: string[]): Promise<void> {
  let handle = await navigator.storage.getDirectory()
  for (const segment of segments) handle = await handle.getDirectoryHandle(segment, { create: true })
  vfs.mount(mountPoint, await resolveMountConfig({ backend: WebAccess, handle }))
}

export function unmountAccountFiles(): void {
  if (!mounted) return
  vfs.umount(FILES_ROOT)
  mounted = false
}
