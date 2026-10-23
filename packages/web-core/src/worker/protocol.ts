import type { DataRequest, DataResponse } from '@shared/data/api/types'

/** `ipcRenderer.send` channel on which the page reports its color scheme (`ThemeMode`). */
export const NATIVE_THEME_CHANNEL = 'web:native-theme'

/** `webContents.send` channels for what the desktop main process does to its window or the OS. */
export const PageChannel = {
  /** `app.relaunch()`: the page reloads, which starts a new Core Worker. */
  Relaunch: 'web:relaunch',
  /** `shell.openExternal(url)`: the page opens the URL in a new tab. */
  OpenExternal: 'web:open-external',
  /** `BrowserWindow.loadURL(url)`: the page shows the renderer entry at `url` (handled by the app). */
  LoadUrl: 'web:load-url',
  /** A local folder needs the user's permission again (`LocalFolderAccessRequest`); only a click in the page can ask. */
  LocalFolderAccess: 'web:local-folder-access'
} as const

/** What the page needs to ask for access to a stored folder again: only a click in the page can ask. */
export interface LocalFolderAccessRequest {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
}

export interface OpenResult {
  path: string
  openMs: number
  migrateMs: number
}

/** Commands every Core Worker understands; hosts may register more (see `startCoreWorker`). */
export interface CoreCommands {
  open: { payload: { account: string; handoverTimeoutMs?: number }; result: OpenResult }
  request: { payload: DataRequest; result: DataResponse }
  /** The page's `ipcRenderer.invoke`: runs the `ipcMain.handle` handler for `channel`. */
  'ipc-invoke': { payload: { channel: string; args: unknown[] }; result: unknown }
  /** The page's `ipcRenderer.send`: runs the `ipcMain.on` listeners for `channel`. */
  'ipc-send': { payload: { channel: string; args: unknown[] }; result: void }
  close: { payload: undefined; result: void }
  /** A folder from `showDirectoryPicker()`: stored for the account and mounted; answers its path. */
  'local-folder.add': { payload: { handle: FileSystemDirectoryHandle }; result: string }
  /** The user allowed access to a stored folder again: it is mounted. */
  'local-folder.allow': { payload: { id: string }; result: void }
}

export interface CommandMessage {
  id: number
  command: string
  payload: unknown
}

export interface SerializedError {
  name: string
  message: string
  code?: string
}

export type ReplyMessage =
  | { kind: 'reply'; id: number; ok: true; result: unknown }
  | { kind: 'reply'; id: number; ok: false; error: SerializedError }

/** A `webContents.send` to the page (e.g. `DataApi_DataChanged`), with its arguments. */
export interface BroadcastMessage {
  kind: 'broadcast'
  channel: string
  args: unknown[]
}

export type WorkerMessage = ReplyMessage | BroadcastMessage
