import type { DataRequest, DataResponse } from '@shared/data/api/types'

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
