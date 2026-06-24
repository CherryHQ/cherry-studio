# Concurrency

General concurrency primitives for the main process. **Event-source-agnostic** — nothing here knows
about Preference, lifecycle, IPC, or any specific trigger.

## `createLatestReconciler`

A **latest-wins async side-effect reconciler**: when an async side effect can be triggered many times
in quick succession and only the *latest* intent matters, it serialises the effect, coalesces bursts
to the latest, and re-reads the world each pass so the final result matches the final intent.

| Property | Behaviour |
|---|---|
| single-flight | Never runs two `apply`s at once (a `running` guard). |
| latest-wins / coalescing | Requests arriving during an in-flight `apply` collapse into **one** follow-up pass. Intermediate states are never replayed — no per-event queue. |
| level-triggered | Each pass re-reads `getSnapshot()` and converges toward it. Immune to the edge-triggered drop where a subscription fires once while a busy handler loses it. |
| terminal failure | A throwing `apply` stops the loop (records the error) instead of retrying the same target forever. A later `request()` re-converges. |

### When to use it (the judgment method)

This is the **core definition** of the tool and has nothing to do with where the trigger comes from.
Use it when **all three** hold:

1. **Async `apply`** — the side effect awaits / yields control (its window can interleave with a new trigger).
2. **Repeated, possibly fast-succession triggers** — the same effect is asked for again and again.
3. **Only the latest intent matters** — intermediate states are *disposable target states* (idempotent
   convergence), not cumulative commands that must each execute.

Do **not** use it for:

| Anti-case | Why | Use instead |
|---|---|---|
| Synchronous side effect | Runs to completion; nothing can interleave, nothing to coalesce. | Just call it. |
| Command / delta semantics (every event must run, in order) | Coalescing would drop work. | A FIFO queue (e.g. `p-queue`, `async-mutex`). |
| Per-key serialisation of independent items | Reconciler is single-stream. | `KeyedMutex` (`src/main/ai/streamManager/KeyedMutex.ts`). |

> Precondition: a **successful** `apply` must make progress toward `isSettled` (be convergent /
> idempotent). If `apply` can succeed without converging, the loop spins — that is a consumer bug,
> not something the reconciler guards against. (Same contract as a Kubernetes reconcile loop.)

### Wiring (the trigger source is irrelevant)

Every source funnels into the same `request()` — the reconciler is blind to which one fired:

```ts
const reconciler = createLatestReconciler({ name, getSnapshot, isSettled, apply })

preference.subscribeChange('feature.x.enabled', (v) => { this.desired = v; reconciler.request() }) // Preference
emitter.event(() => reconciler.request())                                                          // Emitter
setImmediate(() => reconciler.request())                                                           // deferred / warm-up
ipc.on('x.refresh', () => reconciler.request())                                                    // IPC event
```

`getSnapshot` is **push or pull**: read an owned field (`() => this.desired`) or read the world
(`async () => readActualState()`). Pull re-reads truth every pass and is immune to a slot diverging
from reality; push is fine when one field is the single source of intent.

### API

| Member | Contract |
|---|---|
| `request()` | Mark dirty, ensure the loop runs. Cheap, re-entrant. Many calls collapse to one re-read. No-op after `dispose()`. |
| `flush()` | Resolve when the loop is **quiescent** (settled, or stopped after a failed/no-progress pass with nothing pending). Does **not** wait for `isSettled === true` — a failing or not-ready target settles the loop without converging, so awaiting "settled" would hang. Check the post-condition yourself after `flush()`. |
| `getLastError()` | Error from the most recent failed `getSnapshot`/`apply`, or `null` after a clean pass. |
| `dispose()` | Stop accepting work. An in-flight `apply` completes; no new pass starts. |

Imperative callers converge then assert the post-condition themselves:

```ts
async start() {
  this.desired = true
  this.reconciler.request()
  await this.reconciler.flush()
  if (!this.isActivated) throw this.failureError() // failureError reads getLastError()
}
```

### Disposal — usually you don't

`dispose()` is a **stop-applying switch, not resource cleanup**: the reconciler holds no OS resources
(only closures + flags), so an undisposed one leaks nothing and is GC'd with its owner. The question is
never "did I free it" but **"can a `request()` still arrive after the work should stop?"** — i.e. is the
reconciler **shorter-lived than its trigger sources**.

| Ownership | Dispose? |
|---|---|
| Construct-once field; triggers torn down with the owner (subscriptions via `registerDisposable`, IPC handlers) | **No.** Nothing calls `request()` after teardown; the instance is GC'd on destroy. |
| Recreated per cycle (e.g. a fresh reconciler each `onActivate()`) while a trigger source outlives it | **Yes** — dispose the old one in `onDeactivate()` before creating the next, so a late/racing `request()` can't fire a stale `apply`. |

> ⚠️ Do **not** `registerDisposable(() => reconciler.dispose())` for a construct-once field. That fires
> on **stop**, but the field is **not** recreated on restart (`start()` re-runs `onInit()`), so
> `request()` would be permanently no-op afterward. `ApiGatewayService` deliberately does **not** dispose.

### Relation to `lifecycle/`

`lifecycle/` ships `Emitter`/`Event` (multi-shot fan-out) and `Signal` (one-shot completion) for
**notification**. This reconciler is for **convergence**: turning a stream of "something changed"
notifications into one settled async side effect. They compose — an `Emitter` event handler is a
perfectly good `request()` trigger.

### Application case: lifecycle `Activatable` services

One concrete instance of the judgment method, not the tool's definition. An `Activatable` service whose
`onActivate`/`onDeactivate` is async **and** has a runtime toggle source can have its running state
diverge from intent under fast toggling (the `_activating` short-circuit drops the opposing toggle).
Map the three conditions onto the activate/deactivate path:

| `onActivate`/`onDeactivate` | runtime toggle source | Needs a reconciler? |
|---|---|---|
| at least one async (awaits / yields) | yes | ✅ yes |
| both synchronous | yes / no | ❌ no — run-to-completion, can't interleave |
| any | none (startup-only) | ❌ no — no reverse trigger |
| has `setImmediate` / deferred activation | yes | ✅ yes — warm-up race |

The service **self-holds** a reconciler (`getSnapshot: () => ({ desired, actual: this.isActivated })`,
`apply: ({ desired }) => desired ? this.activate() : this.deactivate()`) — `BaseService` core is **not**
changed. `ApiGatewayService` is the reference consumer.
