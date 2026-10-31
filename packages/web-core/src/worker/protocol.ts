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

/** A main-process broadcast (e.g. `DataApi_DataChanged`) forwarded to the page. */
export interface BroadcastMessage {
  kind: 'broadcast'
  channel: string
  payload: unknown
}

export type WorkerMessage = ReplyMessage | BroadcastMessage
