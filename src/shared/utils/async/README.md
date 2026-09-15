# Asynchronous primitives

Import application-level asynchronous mechanisms through `@shared/utils/async`.
Callers own every instance, resource, cancellation decision, and business policy.
This module contains reusable functions and class definitions for main and renderer.

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
