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
 * The error codes the IpcApi framework itself produces. This const is the single
 * source of truth for the *known* codes — throw sites reference it instead of bare
 * string literals, so a typo is a compile error, not a silent miscategorized error.
 *
 * `code` stays an open `string` across the boundary on purpose: codes are rebuilt
 * via {@link IpcError.fromJSON}, migrated domains throw their own codes, and
 * {@link IpcError.from} normalizes arbitrary throws to `INTERNAL` — a closed union
 * would be a lie at the deserialization boundary. The `IpcErrorCode` type therefore
 * keeps the framework literals (for IDE completion / branching on known codes) while
 * the `(string & {})` tail leaves the set open for domain and unknown codes.
 */
export const IpcErrorCode = {
  /** Route key is not an own-property of the request registry. */
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  /** Input failed the route's zod schema (carries `{ issues }`). */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Sender frame failed the source-trust gate (`validateSender`). */
  FORBIDDEN_SENDER: 'FORBIDDEN_SENDER',
  /** Catch-all for any non-`IpcError` throw. */
  INTERNAL: 'INTERNAL'
} as const

export type IpcErrorCode = (typeof IpcErrorCode)[keyof typeof IpcErrorCode] | (string & {})

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

  constructor(code: IpcErrorCode, message: string = code, data?: unknown) {
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
    if (value instanceof Error) return new IpcError(IpcErrorCode.INTERNAL, value.message)
    return new IpcError(IpcErrorCode.INTERNAL, String(value))
  }
}
