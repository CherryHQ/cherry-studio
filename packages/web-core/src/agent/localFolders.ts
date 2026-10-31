// Folders the user picked for agent workspaces. Their handles are kept per account in IndexedDB and
// mounted under `/local` while the account is open; a folder the browser has not granted again in
// this visit is mounted as unavailable until the page asks the user (`PageChannel.LocalFolderAccess`).
import { vfs } from '@zenfs/core'

import { pageWebContents } from '../runtime/electron'
import { type LocalFolderAccessRequest, PageChannel } from '../worker/protocol'
import { LocalFolderFS, UnavailableFolderFS } from './localFolderFs'

const DB_NAME = 'cherry-studio-local-folders'
const STORE = 'folders'
const ROOT = '/local'

interface StoredFolder {
  key: string
  account: string
  id: string
  name: string
  handle: FileSystemDirectoryHandle
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>
}

let account: string | undefined
const mounted = new Map<string, { folder: StoredFolder; path: string }>()

function request<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () =>
      open.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('account', 'account')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const pending = run(db.transaction(STORE, mode).objectStore(STORE))
      pending.onsuccess = () => resolve(pending.result)
      pending.onerror = () => reject(pending.error)
      pending.transaction!.oncomplete = () => db.close()
    }
  })
}

function folderPath(folder: Pick<StoredFolder, 'id' | 'name'>): string {
  return `${ROOT}/${folder.id}/${folder.name}`
}

// OPFS handles, which the tests pick, have no permission API and are always accessible.
async function isGranted(handle: PermissionHandle): Promise<boolean> {
  return !handle.queryPermission || (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
}

async function mount(folder: StoredFolder): Promise<string> {
  const path = folderPath(folder)
  if (mounted.has(folder.id)) vfs.umount(path)
  if (await isGranted(folder.handle)) {
    vfs.mount(path, new LocalFolderFS(folder.handle))
  } else {
    const access: LocalFolderAccessRequest = { id: folder.id, name: folder.name, handle: folder.handle }
    vfs.mount(
      path,
      new UnavailableFolderFS(folder.name, () => pageWebContents.send(PageChannel.LocalFolderAccess, access))
    )
  }
  mounted.set(folder.id, { folder, path })
  return path
}

/** Mounts the account's stored folders; runs when the account opens. */
export async function mountLocalFolders(openedAccount: string): Promise<void> {
  account = openedAccount
  const folders = await request<StoredFolder[]>((store) => store.index('account').getAll(openedAccount), 'readonly')
  for (const folder of folders) await mount(folder)
}

export function unmountLocalFolders(): void {
  for (const { path } of mounted.values()) vfs.umount(path)
  mounted.clear()
  account = undefined
}

/** Stores a picked folder, or finds it if it was picked before, mounts it and returns its path. */
export async function addLocalFolder(handle: FileSystemDirectoryHandle): Promise<string> {
  if (!account) throw new Error('No account is open')
  for (const { folder } of mounted.values()) {
    if (await folder.handle.isSameEntry(handle)) return mount(folder)
  }
  const id = crypto.randomUUID().slice(0, 8)
  const folder: StoredFolder = { key: `${account}/${id}`, account, id, name: handle.name, handle }
  await request((store) => store.put(folder), 'readwrite')
  return mount(folder)
}

/** Mounts a folder again after the page has asked the user for access. */
export async function allowLocalFolder(id: string): Promise<void> {
  const entry = mounted.get(id)
  if (entry) await mount(entry.folder)
}

/** Whether `path` is where a stored folder is mounted, the only paths the Web registers as workspaces. */
export function isLocalFolderPath(path: string): boolean {
  return [...mounted.values()].some((entry) => entry.path === path)
}
