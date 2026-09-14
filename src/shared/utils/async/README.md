# Asynchronous primitives

Import application-level asynchronous mechanisms through `@shared/utils/async`.
This module owns reusable code and class definitions; callers own every instance,
resource, cancellation decision, and business policy. It runs in both main and renderer.

The organization follows [VS Code's common async module](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/async.ts):
centralize mechanisms while leaving business operations with their owners. This is
not a copy of VS Code's cancellation-token or lifecycle framework.

## Choosing a primitive

| Need | API | Contract |
| --- | --- | --- |
| Deferred completion with late waiters | `createDeferred<T>()` / `Deferred<T>` | Native resolver shape with passive rejection observation; preserves the original promise and error. |
| Wait between attempts | `delay(ms, signal?)` | Cancellation rejects with the original `signal.reason`; the timer and listener are released. |
| Deadline with fallback | `raceTimeout(promise, ms, onTimeout, options?)` | Returns the result or caller fallback, releases the timer on every settlement. Does not cancel work. |
| Deadline with failure | `withTimeout(promise, ms, errorFactory, options?)` | Same ownership; rejects with the caller's error. |
| One deadline across a drain loop | `createTimeout(ms, onTimeout, options?)` | Reuse `.promise` for each round and call `.dispose()` in `finally`. Disposal releases the timer without settling the promise. |
| Cancel one waiter | `raceCancellation(promise, signal?, reason?)` | Removes the abort listener promptly, observes late rejection, leaves shared work running. Optional `reason` preserves a boundary's error mapping. |
| Own a cancellable task | `createCancelablePromise(factory, onLateResult?)` | Starts eagerly with an owned signal; `cancel(reason?)` rejects the wait and signals the producer. Late-result cleanup requires explicit ownership. |
| Subscribe to cancellation | `onAbort(signal, callback)` | Calls back synchronously for an already-aborted signal, otherwise once on abort, with the original reason. Returns idempotent detachment. |
| Native timeout and parent cancellation | `timeoutSignal(timeoutMs, parent?)` | Uses native timeout and signal composition, preserving validation and the first abort reason. No disposable timer handle. |
| Disposable timeout and parent cancellation | `createDisposableTimeoutSignal(timeoutMs, timeoutReason, parent?)` | Calls the reason factory at expiry. Disposal clears only the deadline; parent cancellation remains connected. |
| Recognize or create an AbortError | `isAbortError(error)` / `createAbortError(message)` | Exact structural name check; factory creates an ordinary Error with the caller's message. Domain classifiers keep their additional rules. |
| Retry a transient failure | `retry(operation, options)` | Caller supplies total attempts, backoff, and error predicate. Cancels backoff promptly; no delay after the final attempt. |
| FIFO tasks | `Sequencer` / `SequencerByKey<K>` | Every task runs. Failure does not poison successors; keyed sequences release idle keys. Only `SequencerByKey.flush()` waits for a current snapshot and absorbs task errors already delivered to callers. |
| Scoped or manually released lock | `Mutex` / `KeyedMutex` / `Semaphore` / `tryAcquire` | Existing `async-mutex` contract; manual releases remain the owner's responsibility. |
| Bounded concurrency | `PQueue` | Existing `p-queue` implementation and API, including its cooperative cancellation semantics. |
| Debounce / throttle | `debounce` / `throttle` | Existing `es-toolkit/compat` behavior, including `cancel`, `flush`, and leading/trailing options. |
| Latest-state convergence | `createLatestReconciler` | Coalesces intermediate requests, re-reads state, stops after failure. The owner supplies `onError`. |
| Join one current operation | `SingleFlight<T>` | Starts eagerly, shares the active result, releases on success or failure, and permits a fresh later run. `promise` is undefined while idle. |
| Coalesce a save drain | `CoalescingTask` | Starts eagerly, keeps only the latest pending callback, and shares the whole drain result. A failure rejects the drain and discards pending work. |
| Lazy resource initialization | `AsyncInitializer` | Shares initialization and caches success or asynchronous failure. |
| Push events into an async iterator | `AsyncEventQueue` | FIFO; close drains buffered values, resolves pending readers, ignores later pushes. |
| Resettable inactivity deadline | `IdleTimeoutController` / `withIdleTimeout` | Resets on activity and aborts with `TimeoutError`; `dispose()` permanently releases the watchdog without aborting work. |

`TimeoutOptions.ref: false` preserves Node deadlines that must not keep the process alive.
It has no effect on browser timer handles.

Use native `Promise.withResolvers()` for plain resolver allocation. Use `createDeferred()`
when a deferred can reject before a waiter attaches: it observes rejection without
turning that rejection into success. Resolve-only gates do not need that observer. Keep ordinary `async/await`,
`Promise.all`, `allSettled`, and races between independent events at the call site.
They do not need wrappers.

### Choosing a coordination contract

Assume A is running when requests B and C arrive:

| API | Work executed | What callers await | Failure |
| --- | --- | --- | --- |
| `SingleFlight` | A | The same active result | Releases the flight; a later request can retry. |
| `Sequencer` | A → B → C | Each caller's own task | Later tasks still run. |
| `CoalescingTask` | A → C | The entire shared drain | Rejects all drain waiters and drops pending work. |
| `AsyncInitializer` | The first initialization | The cached initialization result, even after completion | Async failure is cached; a synchronous factory throw is not. |
| `createLatestReconciler` | Repeated reads and applies until settled | Quiescence, which can also follow failure | Reports via `onError` / `getLastError`; `flush()` does not reject. |

VS Code's `Throttler` and `LimitedQueue` also keep the latest pending task, but
the active caller waits only for its own task and an active failure does not
discard pending work. They are not drop-in replacements for `CoalescingTask`.
VS Code's `raceCancellation` returns a fallback on cancellation; this module's
rejecting contract corresponds to its `raceCancellationError`.

### Disposal

The existing lifecycle `Disposable` contract is defined in
[`@shared/types/disposable`](../../types/disposable.ts) and remains exported by
main's lifecycle entry. There is no separate `IDisposable` or new cleanup framework.
Deadline handles and the inactivity watchdog use that same `dispose(): void` shape.
Main services can pass them directly to `BaseService.registerDisposable()`;
renderer owners dispose them in effect cleanup. Stop-scoped resources must be
created again on restart, rather than registered once as permanent service fields.

Disposal is resource-specific: `createTimeout` releases its timer but leaves its
promise pending; `createDisposableTimeoutSignal` clears its deadline but retains
parent cancellation; the inactivity watchdog cannot be rearmed after disposal.
Disposing the handle returned by `withIdleTimeout` also detaches its abort listener.
It does not cancel or consume the source stream. Use a bounded `reset(durationMs)`
for temporary long waits such as approval; disposal is final.

## Cancellation and ownership

### Owned tasks and independent waiters

`createCancelablePromise(factory, onLateResult?)` returns a native Promise with
an additional `cancel(reason?)` method. The factory receives an `AbortSignal`;
it may return a value or thenable, and synchronous throws become rejections.
Cancellation is idempotent, preserves the first reason (native `AbortError` when
omitted), and ends the public wait even if the producer ignores its signal.
Once the producer's success or failure has been observed, cancellation is a no-op.
This does not retract already delivered values or queued consumer callbacks.

The task owner holds cancellation authority. A consumer of shared work instead
uses `raceCancellation(task, consumerSignal)`, which cancels only that consumer's
wait. `then`, `catch`, `finally`, and wrapping the task in an async function return
ordinary promises; cancellation authority does not propagate through chaining.

Unlike VS Code, this helper never guesses ownership from a result's `dispose`
method. Supply `onLateResult` only for resources exclusively owned by this task:

```ts
const task = createCancelablePromise(
  (signal) => loadOwnedResource(signal),
  (resource) => resource.dispose()
)
```

The callback runs once if cancellation wins and a result arrives later, including
when an already-resolved producer has not yet had its result observed. It never
runs for a result delivered normally. Async cleanup is supported, but the cancelled
task does not wait for it; callback failures are observed like other late producer
failures and cannot replace the cancellation reason. Report cleanup failures in
the callback when needed. Without this callback, the producer retains cleanup
responsibility. Intermediate resources always need producer-side `finally` cleanup.

The helper composes `raceCancellation`; it does not replace it, enforce latest-request
identity, stop non-cooperative operations, or prove that producer cleanup has finished.
Keep phase checkpoints, progressive-event guards, and resource-drain barriers with
their owners. It does not implement `Disposable`: ending a task and releasing an
already acquired resource are separate responsibilities.

Stopping a wait does not prove that the task exited. Process termination, worker
disposal, queue slots, database writes, and job terminal states remain with the
owning subsystem. In particular, a utility-process termination cancellation must
still hold the queue slot until process exit.

`onAbort` only owns the listener. Callers keep controller ownership, remote aborts,
reason mapping, and resource cleanup. Its callback may run before registration
returns, so it must not depend on the returned detach function being assigned.
Use `timeoutSignal` for a native deadline combined with an optional parent signal.
Use `createDisposableTimeoutSignal` when the owner must dispose the deadline after work settles
and supply its own timeout reason. Disposal does not abort the signal or detach its
parent. Keep native `AbortSignal.any` for other signal combinations, standalone
`AbortSignal.timeout` calls, and `signal.throwIfAborted()` checkpoints directly at
their call sites. Fixed native timeout signals do not replace resettable deadlines.

HTTP callers must pass the timeout signal to the transport to stop a request.
Promise-only deadline helpers do not cancel network requests.

### Cancellation checkpoints

Keep `signal.throwIfAborted()` at boundaries that prevent identifiable work:
operation admission, a queued task starting, the next polling round, and resuming
after non-cancellable work before starting another phase. Recheck the owner's
signal after `catch` or `allSettled` when cancellation could otherwise start a
fallback or retry. Native checks preserve the original `signal.reason`.

Do not add a check after every `await` or repeat it in synchronous private helpers.
Pass the signal to APIs that support cancellation. For UI work that cannot be
cancelled, silently discard stale completions using one lifecycle state; retain
request identity checks when multiple requests can overlap.

Before publishing a result, the owner decides where cancellation stops winning.
File-processing persistence checks after ZIP extraction and before starting the
atomic write; once that write starts, it finishes and reports its outcome. Remote
task IDs and stage transitions must be saved before honoring cancellation so
recovery can resume them. Cleanup and resource-drain barriers always complete.

Main's `core/concurrency/latestReconciler.ts` is a logging adapter around this module.
Channels own their timing and completion policy in
[`FlushController`](../../../main/ai/channels/FlushController.ts), composed from
`SingleFlight` and `createTimeout`. Busy `flush()` returns immediately;
`waitForFlush()` joins only the current callback and absorbs its failure.
`complete()` releases pending timers and stops future work. `reset()` resets
pending scheduling while retaining the active callback and its waiters.

`IdleTimeoutController` defaults to a `TimeoutError`. A caller may provide a reason
factory; returning `undefined` preserves the native `AbortController` abort reason.

Lifecycle `Signal` / `Emitter`, `BaseService.registerInterval`, `SchedulerService`,
and React timer hooks retain their process-specific notification and cleanup duties.

## Library choices

Keep `p-queue` and `async-mutex`; the facade re-exports their existing implementations.
`delay` delegates timing to `es-toolkit` and restores the original abort reason.
The installed `es-toolkit` timeout helper leaves its timer running after early
completion; its retry helper waits after the final failure and cannot cancel the
backoff. The small local helpers cover these contracts without a new dependency.

## Audit boundary

The 2026-09-09 audit scanned Git-tracked JS/TS syntax across `src`, packages,
scripts, resources, examples, and tests, separating production from tests/demos.
The application production baseline contained 4,534 async functions, 199 Promise
constructors, and 30 Promise races. These are inventory counts, not defect counts.

Migrated mechanisms include inline sleeps, abort-aware polling waits, timeout
races, keyed Promise chains, deferred resolver captures, and existing asynchronous
utility classes. Domain retry predicates, backoff values, and log messages remain
with the caller. Import restrictions and the topic barrel enforce the public entry.

The remaining forms have distinct owners:

- Event / callback bridges for streams, sockets, files, DOM, IPC, and workers keep
  their cleanup beside the resource whose events settle the Promise.
- Durable job retries, provider failover, SDK retry protocols, and data-request
  reconstruction retain domain policy; their generic waits use this module.
- UI animation frames, hook teardown, scheduler timers, cache flush timers, and
  process shutdown timers retain their lifecycle semantics.
- Standalone packages, build scripts, injected browser scripts, vendored code,
  fixtures, and demonstration delays do not import the Electron application's
  `src/shared` module. Native or package-owned facilities remain their boundary.

Run the shared tests for this directory plus the affected consumer suites when
changing a contract. Timer cleanup, original abort reasons, delayed process exit,
FIFO order, cross-key concurrency, and same-key mutual exclusion are the key checks.
