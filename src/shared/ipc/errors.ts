/**
 * Serialized form of {@link IpcError} that crosses the IPC boundary.
 *
 * Plain JSON so it survives structured clone; the renderer facade reconstructs
 * an {@link IpcError} from it (see the error model in ipc-overview.md).
 */
export interface SerializedIpcError {
  code: string
  message: string
  data?: unknown
}

/**
 * The structured result envelope every IpcApi request resolves to. The main side
 * returns it (it never throws to `ipcMain.handle`, which would drop `code`/`data`)
 * and the renderer facade unwraps it. Single source of truth shared by both
 * processes — neither side should redefine this shape locally.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedIpcError }

/**
 * Lightweight transport error for the IpcApi RPC channel.
 *
 * Deliberately NOT reusing DataApiError: HTTP-status semantics belong to the
 * remotable data layer, whereas IpcApi is a local command channel keyed by a
 * string `code`. Handlers never throw this to `ipcMain.handle` directly — the
 * IpcApiService wraps results as `{ ok, data } | { ok: false, error }`, because
 * Electron's `invoke` reject keeps only `message` and drops `code`/`data`.
 */
export class IpcError extends Error {
  readonly code: string
  readonly data?: unknown

  constructor(code: string, message: string = code, data?: unknown) {
    super(message)
    this.name = 'IpcError'
    this.code = code
    if (data !== undefined) this.data = data
  }

  toJSON(): SerializedIpcError {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }

  static fromJSON(json: SerializedIpcError): IpcError {
    return new IpcError(json.code, json.message, json.data)
  }

  /** Normalize any thrown value into an IpcError (INTERNAL for unknown causes). */
  static from(value: unknown): IpcError {
    if (value instanceof IpcError) return value
    if (value instanceof Error) return new IpcError('INTERNAL', value.message)
    return new IpcError('INTERNAL', String(value))
  }
}
