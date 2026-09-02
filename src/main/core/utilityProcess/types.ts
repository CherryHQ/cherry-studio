/**
 * Public types of the utility-process layer. The contract types are TypeScript-only: main and
 * child come from the same signed build, so method maps carry no runtime validation (RFC §3.1).
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
  /** Init data passed to the child's `initialize()`, evaluated per generation; opaque to core. */
  createInitData?: () => InitData
  /** Phantom brand so definitions of different contracts are distinct types; never present at runtime. */
  readonly __contract?: Contract
}>

/** The closed set of definitions installed once at boot. */
export type UtilityProcessManifest = readonly UtilityProcessDefinition<any, any>[]

export interface UtilityProcessRequestOptions<Event> {
  signal?: AbortSignal
  /** Called synchronously and in order for each event; a throw cancels the request under the definition's policy. */
  onEvent?: (event: Event) => void
}

export interface UtilityProcessResetOptions {
  /** Clear the consecutive-failure count (reopen the circuit) once the operation succeeds. */
  resetFailures?: boolean
}

export interface UtilityProcessClient<Contract extends UtilityProcessContract> {
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
