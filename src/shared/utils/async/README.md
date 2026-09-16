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
