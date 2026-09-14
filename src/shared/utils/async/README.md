# Asynchronous primitives

Import application-level asynchronous mechanisms through `@shared/utils/async`.
Callers own every instance, resource, cancellation decision, and business policy.
This module contains reusable functions and class definitions for main and renderer.

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
Keep `signal.throwIfAborted()` at admission and phase boundaries that prevent
identifiable work. Native cancellation checks and mandatory cleanup stay with owners.
Do not add checks after every await or report an already committed write as cancelled.

## Waiting, deadlines, and retry

| Need | API | Contract |
| --- | --- | --- |
| Cancellable delay | `delay` | Reject with the original abort reason; release the timer. |
| Retry transient work | `retry` | The owner supplies attempts, backoff, and retry predicates; no wait after the last failure. |
| Reusable deadline | `createTimeout` | Dispose the timer in finally; disposal leaves its promise pending. |
| Deadline fallback or failure | `raceTimeout`, `withTimeout` | Release the timer when the wait settles; do not cancel the producer. |
| Native deadline signal | `timeoutSignal` | Compose native timeout with parent cancellation; first reason wins. |
| Releasable deadline signal | `createDisposableTimeoutSignal` | Dispose only the timer; parent cancellation remains connected. |
| Inactivity watchdog | `IdleTimeoutController`, `withIdleTimeout` | Reset on activity; disposal is final and releases the watchdog and its listener. |

Pass signals to transports when cancellation should stop I/O. Ending a wait does
not prove that the producer exited or finished releasing resources.

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


## Coordination contracts

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

`AsyncEventQueue` bridges pushed events to an async iterator. `KeyedMutex`
provides same-key mutual exclusion; owners retain responsibility for releasing
event-scoped acquisitions. The main reconciler adapter retains default logging.

`Mutex`, `Semaphore`, `tryAcquire`, `PQueue`, `debounce`, and `throttle` re-export
the existing libraries; this module does not replace their implementations.

## Deferred completion

`createDeferred` uses native resolvers and observes early rejection without
replacing the original promise or error. `ProcessHost` owns process exit and
keeps its execution slot until that resource barrier completes.
