/**
 * Public types of the utility-process layer. The contract types are TypeScript-only: main and
 * child come from the same signed build, so method maps carry no runtime validation.
 */

/** One RPC method exposed by a utility process: its input, output, and streamed event types. */
export type UtilityProcessMethod<Input, Output, Event = never> = {
  input: Input
  output: Output
  event: Event
}

/** The method map a definition and its entry share. */
export type UtilityProcessContract = {
  methods: Record<string, UtilityProcessMethod<unknown, unknown, unknown>>
  streams?: Record<
    string,
    UtilityProcessStreamMethod<unknown, UtilityProcessStreamFrame, UtilityProcessStreamFrame, unknown>
  >
}

/** Flat metadata and an optional byte view; arbitrary object graphs are not stream frames. */
export type UtilityProcessStreamFrame = {
  metadata: Readonly<Record<string, string | number | boolean | null>>
  payload?: Uint8Array
}

export type UtilityProcessStreamMethod<
  Request,
  Input extends UtilityProcessStreamFrame,
  Output extends UtilityProcessStreamFrame,
  Result
> = {
  request: Request
  input: Input
  output: Output
  result: Result
}

export type UtilityProcessStreams<C extends UtilityProcessContract> = NonNullable<C['streams']>

export interface UtilityProcessStreamLimits {
  maxFrameBytes: number
  maxBufferedBytes: number
  maxBufferedFrames: number
  maxPendingWrites: number
}

export interface UtilityProcessStreamOptions {
  signal?: AbortSignal
  input: UtilityProcessStreamLimits
  output: UtilityProcessStreamLimits
}

export interface UtilityProcessStream<Input, Output, Result> {
  /** Single consumer; advancing releases capacity for the previous frame. */
  readonly output: AsyncIterable<Output>
  readonly completed: Promise<Result>
  /** Resolves only after handler cleanup acknowledgement or confirmed process exit. */
  readonly closed: Promise<void>
  write(frame: Input): Promise<void>
  finishInput(): Promise<void>
  cancel(): Promise<void>
}

/**
 * How `request(..., { signal })` cancels work in the child.
 * - `cooperative`: the child aborts the handler's `signal`; main rejects immediately.
 * - `terminate`: cancelling any request kills the whole generation — for native calls that cannot be interrupted.
 */
export type UtilityProcessCancellation = 'terminate' | 'cooperative'

export type UtilityProcessDefinition<Contract extends UtilityProcessContract, InitData = void> = Readonly<{
  /** Unique lowercase namespaced identifier, e.g. `inference.embedding`. */
  id: string
  /** Lowercase build-manifest key; core resolves the emitted `out/utility-process/<entry>.js`. */
  entry: string
  cancellation: UtilityProcessCancellation
  /** Positive integer; absent = live until `stop()` or app quit. */
  idleTimeoutMs?: number
  /** Extra environment variables, evaluated per generation; additive only (see host/environment.ts). */
  createEnv?: () => Readonly<Record<string, string>>
  /**
   * Init data passed to the child's `initialize()`, evaluated per generation; opaque to core.
   * May be async — it is awaited while the process launches, inside the ready budget.
   */
  createInitData?: () => InitData | Promise<InitData>
  /** Phantom brand so definitions of different contracts are distinct types; never present at runtime. */
  readonly __contract?: Contract
}>

export interface UtilityProcessRequestOptions<Event> {
  signal?: AbortSignal
  /** Request-scoped reverse RPC; absent means the child has no host capabilities. */
  onHostCall?: (method: string, input: unknown, signal: AbortSignal) => Promise<unknown>
  /** Called synchronously and in order for each event; a throw cancels the request under the definition's policy. */
  onEvent?: (event: Event) => void
}

export interface UtilityProcessResetOptions {
  /** Clear the consecutive-failure count (reopen the circuit) once the operation succeeds. */
  resetFailures?: boolean
}

export interface UtilityProcessClient<Contract extends UtilityProcessContract> {
  openStream<M extends keyof UtilityProcessStreams<Contract> & string>(
    method: M,
    input: UtilityProcessStreams<Contract>[M]['request'],
    options: UtilityProcessStreamOptions
  ): Promise<
    UtilityProcessStream<
      UtilityProcessStreams<Contract>[M]['input'],
      UtilityProcessStreams<Contract>[M]['output'],
      UtilityProcessStreams<Contract>[M]['result']
    >
  >

  request<M extends keyof Contract['methods'] & string>(
    method: M,
    input: Contract['methods'][M]['input'],
    options?: UtilityProcessRequestOptions<Contract['methods'][M]['event']>
  ): Promise<Contract['methods'][M]['output']>

  /** Short barrier: shut the live generation down; the next `request()` lazily respawns. */
  stop(options?: UtilityProcessResetOptions): Promise<void>

  /** Maintenance gate: runs `operation` only after a confirmed exit; new requests fail fast with PROCESS_BLOCKED meanwhile. */
  withStopped<T>(operation: () => T | Promise<T>, options?: UtilityProcessResetOptions): Promise<T>
}

export interface UtilityProcessInstance<
  Contract extends UtilityProcessContract
> extends UtilityProcessClient<Contract> {
  dispose(): Promise<void>
}
