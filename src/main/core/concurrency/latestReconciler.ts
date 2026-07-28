import { loggerService } from '@logger'

const logger = loggerService.withContext('latestReconciler')

/**
 * Options for {@link createLatestReconciler}.
 *
 * @typeParam T - The snapshot type produced by {@link LatestReconcilerOptions.getSnapshot} and
 *   consumed by {@link LatestReconcilerOptions.isSettled} / {@link LatestReconcilerOptions.apply}.
 *   It can be the desired target, the observed world state, or a `{ desired, actual }` pair —
 *   whatever lets `isSettled`/`apply` decide and act.
 */
export interface LatestReconcilerOptions<T> {
  /** Identifies the reconciler in logs. Use the owning concern, e.g. `'apiGateway'`. */
  name: string
  /**
   * Read the latest intent/world snapshot. Called once at the start of every loop pass — it is
   * **re-read every pass**, which is what makes the loop level-triggered rather than
   * edge-triggered. May be synchronous (read an owned field) or asynchronous (pull world state).
   * A value read here always reflects the most recent {@link LatestReconciler.request}.
   */
  getSnapshot: () => T | Promise<T>
  /**
   * True when `snap` needs no work (already converged). When it returns true and no newer
   * `request()` is pending, the loop stops.
   *
   * Precondition: a successful {@link LatestReconcilerOptions.apply} must move the world toward
   * settled (be convergent/idempotent). If `apply` can succeed without making progress, the loop
   * spins — that is a consumer contract violation, not something the reconciler guards against.
   */
  isSettled: (snap: T) => boolean
  /**
   * Drive the side effect that moves the world toward `snap`. Awaited; the loop never runs two
   * `apply`s concurrently (single-flight). Throwing records the error (see
   * {@link LatestReconciler.getLastError}) and stops the loop unless a newer `request()` arrived
   * meanwhile — it is NOT auto-retried for the same snapshot.
   */
  apply: (snap: T) => void | Promise<void>
  /**
   * Invoked when `getSnapshot` or `apply` throws. Defaults to logging via `loggerService`.
   * `snap` is `undefined` when `getSnapshot` itself threw.
   */
  onError?: (error: unknown, snap: T | undefined) => void
}

export interface LatestReconciler {
  /**
   * Mark the world dirty and ensure the convergence loop runs. Cheap and re-entrant: if a loop is
   * already running it just flags that another pass is needed (latest-wins — many requests collapse
   * into one re-read; intermediate states are never replayed).
   */
  request(): void
  /**
   * Resolve when the loop is quiescent — i.e. it has stopped because the world is settled OR
   * because an `apply` made no progress (threw) and no newer `request()` is pending. It does NOT
   * wait for `isSettled` to become true: a persistently failing or not-yet-ready target settles the
   * loop without converging, so awaiting "settled" would hang forever. Callers that need the
   * post-condition check it themselves after `flush()` (e.g. read the actual state +
   * {@link LatestReconciler.getLastError}).
   */
  flush(): Promise<void>
  /** The error from the most recent failed `getSnapshot`/`apply`, or `null` after a clean pass. */
  getLastError(): unknown
  /**
   * Stop accepting work: `request()` becomes a no-op and the loop exits after any in-flight `apply`
   * completes (pending `flush()`es then resolve). This is a **stop-applying switch, not resource
   * cleanup** — the reconciler holds none. Most owners never need it: a construct-once field whose
   * triggers are torn down with the owner should NOT be disposed (and never via `registerDisposable`,
   * which fires on stop but won't recreate the field on restart). Dispose only a reconciler that is
   * recreated per cycle while a trigger source outlives it. See the README's "Disposal" section.
   */
  dispose(): void
  readonly isDisposed: boolean
}

/**
 * Create a **latest-wins async side-effect reconciler** — a general, event-source-agnostic
 * primitive for "an async side effect that may be triggered many times in quick succession, where
 * only the latest intent matters".
 *
 * ## What it does
 * - **single-flight**: never runs two `apply`s at once.
 * - **latest-wins / coalescing**: requests that arrive during an in-flight `apply` collapse into a
 *   single follow-up pass that re-reads the latest snapshot — intermediate states are never
 *   replayed (no per-event queue).
 * - **level-triggered**: each pass re-reads `getSnapshot()` and converges toward it, so the applied
 *   result reflects the world's final state, not the order events fired (immune to the classic
 *   edge-triggered drop where a subscription fires once while a busy handler loses it).
 * - **failure is terminal, not a spin**: a throwing `apply` stops the loop (records the error)
 *   instead of retrying the same target forever; a later `request()` re-converges.
 *
 * ## When to use it (event-source-agnostic)
 * All three must hold: (1) the side effect is **async** (its `apply` awaits / yields control); (2)
 * it is triggered **repeatedly, possibly in fast succession**; (3) only the **latest intent**
 * matters (intermediate states are disposable target states, not cumulative commands that must each
 * run). The trigger can be a Preference/Cache subscription, an `Emitter`, an IPC event, a
 * `setImmediate`/timer, or any caller of `request()` — the reconciler is blind to the source. Do
 * NOT use it for synchronous side effects (run-to-completion needs no coalescing) or for
 * command/delta semantics where every event must execute in order (use a FIFO queue instead).
 *
 * ## Why hand-rolled (Library-first checked)
 * The repo already ships `async-mutex` (mutual exclusion) and `p-queue`. Neither covers this shape:
 * a mutex serialises but still runs every queued task (no coalescing, no level-triggered re-read);
 * coalescing helpers (e.g. `promise-coalesce`) dedupe a shared in-flight promise's RETURN value,
 * not "re-read the world and re-apply after the current apply finishes". Mutual exclusion is the
 * trivial part (a `running` boolean); the value is the **dirty re-read loop with terminal-failure
 * semantics**, which no off-the-shelf primitive provides. ~50 lines, no new dependency.
 *
 * @example Self-held by a service, triggered by a preference subscription (push model):
 * ```ts
 * this.reconciler = createLatestReconciler({
 *   name: 'apiGateway',
 *   getSnapshot: () => ({ desired: this.desiredEnabled, actual: this.isActivated }),
 *   isSettled: ({ desired, actual }) => desired === actual,
 *   apply: ({ desired }) => (desired ? this.activate() : this.deactivate())
 * })
 * // any trigger source just calls request():
 * preference.subscribeChange('feature.x.enabled', (v) => {
 *   this.desiredEnabled = v
 *   this.reconciler.request()
 * })
 * // an imperative caller awaits convergence, then checks the post-condition itself:
 * async start() {
 *   this.desiredEnabled = true
 *   this.reconciler.request()
 *   await this.reconciler.flush()
 *   if (!this.isActivated) throw this.failureError()
 * }
 * ```
 */
export function createLatestReconciler<T>(options: LatestReconcilerOptions<T>): LatestReconciler {
  const { name, getSnapshot, isSettled, apply } = options
  const onError =
    options.onError ??
    ((error: unknown): void => {
      logger.error(`[${name}] reconcile failed`, error as Error)
    })

  /** A convergence loop is currently running. Guarantees single-flight `apply`. */
  let running = false
  /**
   * A `request()` arrived that the loop has not yet consumed. Cleared at the top of every pass
   * BEFORE `getSnapshot()`, so a request landing during the async snapshot/apply window re-flags
   * the loop instead of being lost.
   */
  let dirty = false
  let lastError: unknown = null
  let disposed = false
  /** Resolvers for callers awaiting `flush()`; drained when the loop goes quiescent. */
  const flushWaiters: Array<() => void> = []

  const drainFlushWaiters = (): void => {
    while (flushWaiters.length > 0) {
      flushWaiters.shift()!()
    }
  }

  const runLoop = async (): Promise<void> => {
    running = true
    try {
      while (true) {
        // A request after dispose() is a no-op, so once an in-flight apply finishes the loop
        // exits here without starting new work.
        if (disposed) break

        // Clear BEFORE reading: a request during the awaits below re-sets `dirty`, so the pass
        // that read stale state is always followed by another that reads fresh state.
        dirty = false

        let snap: T
        try {
          snap = await getSnapshot()
        } catch (error) {
          lastError = error
          onError(error, undefined)
          if (dirty) continue
          break
        }

        if (disposed) break

        // A request landed during the (possibly async) snapshot read, so `snap` may already be
        // stale: re-read instead of acting on a superseded intent. This makes the snapshot window
        // coalesce exactly like the apply window (latest-wins) — settled or not.
        if (dirty) continue

        if (isSettled(snap)) break

        try {
          await apply(snap)
          // Cleared only after a clean pass actually completes, so `getLastError()` keeps reporting
          // the last failure until a success overwrites it (never a premature null mid-apply).
          lastError = null
        } catch (error) {
          lastError = error
          onError(error, snap)
          // No auto-retry of the same target (a permanent failure must not spin). A request that
          // arrived meanwhile means a (possibly new) target to converge to — keep going.
          if (dirty) continue
          break
        }
        // apply succeeded; loop re-reads to see if more work remains (dirty or still unsettled).
      }
    } finally {
      running = false
      drainFlushWaiters()
    }
  }

  return {
    request(): void {
      if (disposed) return
      dirty = true
      // `runLoop` sets `running = true` synchronously before its first await, so by the time this
      // returns a loop is guaranteed in flight (and a subsequent `flush()` will observe it).
      if (!running) void runLoop()
    },
    flush(): Promise<void> {
      // When no loop is running the reconciler is already quiescent (the loop only exits with
      // `dirty === false`), so there is nothing to await.
      if (!running) return Promise.resolve()
      return new Promise<void>((resolve) => {
        flushWaiters.push(resolve)
      })
    },
    getLastError(): unknown {
      return lastError
    },
    dispose(): void {
      disposed = true
    },
    get isDisposed(): boolean {
      return disposed
    }
  }
}
