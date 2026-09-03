---
description: Wire protocol, generation state machine, cancellation, circuit breaker, and the stop budget of core/utilityProcess
sources:
  - src/main/core/utilityProcess/protocol
  - src/main/core/utilityProcess/runtime
  - src/main/core/utilityProcess/host
---

# Utility Process Protocol & State Machine

How a request becomes a message, how a process becomes a generation, and what each failure code means. Consumer-facing usage is in the [README](./README.md).

## Bootstrap

1. The host builds the environment and init data, resolves `out/utility-process/<entry>.js`, and forks with `stdio: 'pipe'`, `args: []`, `execArgv: []`, and `serviceName: CherryStudio.UtilityProcess.<id>`.
2. On `spawn`, the host sends one `connect` frame over `process.parentPort`, transferring one end of a private `MessageChannelMain`. Init data rides on that frame; an async `createInitData` is started before the fork and awaited here, so it overlaps the launch instead of delaying it. A rejection fails the generation with `PROCESS_START_FAILED`. A `stop()` that landed before `spawn` could not kill yet (Electron's `kill()` has no pid until then): the host kills at `spawn` instead and never connects, so the exit is an intentional `PROCESS_EXITED`; a rejected init-data outcome is discarded once the generation is stopping.
3. The child validates the frame (protocol, version, its own `id`) — a mismatch exits `70` — attaches its port listeners **without starting the port**, and runs `initialize`.
4. `initialize` resolving posts `ready` and starts the port; the queued requests then flow. `initialize` throwing posts `startup-error` and self-exits `71` after 1 s.

After the handshake, `parentPort` carries nothing: all traffic uses the private port, so a stray message on `parentPort` cannot be confused with protocol traffic.

## Frames

Every frame carries `{ protocol: 'cherry.utility-process', version: 1, processId, generation }`. A frame whose identity does not match the live generation is a fatal violation — that is what makes a dying generation's late messages harmless.

| Direction | Frame | Payload |
| --- | --- | --- |
| main → child | `request` | `requestId`, `method`, `input` |
| main → child | `cancel` | `requestId` |
| main → child | `shutdown` | — |
| child → main | `ready` | — |
| child → main | `event` | `requestId`, `event` |
| child → main | `result` | `requestId`, `output` |
| child → main | `error` | `requestId`, `error: { name, message, stack?, code? }` |
| child → main | `startup-error` | `error` |
| child → main | `log` | `level`, `message`, `fields?`, `requestId?` |
| child → main | `protocol-error` | `message`, `requestId?` |

Request ids are per generation and monotonic from 1; the child keeps a high-water mark instead of a set. Payloads cross by structured clone, so typed arrays survive intact (the smoke harness round-trips 4 MiB), and functions, class instances, and DOM-like objects do not.

The version field exists so a stale bundle fails loudly rather than subtly. V1 has no negotiation: main and child ship together.

## Fatal protocol violations

Either side treats these as unrecoverable, kills or exits, and fails everything in flight:

- an identity mismatch, or a frame that fails its shape guard;
- a `request` for an unknown method, a non-monotonic `requestId`, or a request after `shutdown` (child exits `72`);
- a terminal or `event` for a `requestId` main never issued, or a second terminal for one already settled;
- a second `ready` on a ready generation, or a `startup-error` after `ready`. A `ready` that lands while an intentional stop is already under way is a race, not a violation, and is dropped.

A late frame for a *cancelled* request is not a violation: main keeps a tombstone for it and drops the frame silently.

## Uncaught errors

An uncaught exception or unhandled rejection in the child logs at `error`, aborts every active handler, and exits `73`. From that point the child sends no request terminals: a handler unwinding under the crash must not look like a completed dispatch. Main learns of the crash from the exit alone, settles the pending requests as `PROCESS_EXITED`, and counts it against the breaker.

## Generations

A generation is one process from fork to observed exit. There is never more than one live at a time — the successor is created only after the predecessor's `exit` event, which is why a stuck stop blocks respawn instead of doubling up.

```
      first request
            │
            ▼
        starting ──── ready frame ────► ready ──── stop / idle / terminate-cancel ────► stopping
            │                             │                                                │
            └── timeout / startup-error / │── unrequested exit ──► failed (counted)        │
                exit before ready ────────┘                                                ▼
                     (counted)                                                     exit observed
```

Everything that fails a generation goes through one funnel, so the failure is counted at most once, one error object reaches every waiter, and the process is killed if it has not exited. Exit classification is where the policy lives:

| Exit | Code | Counted against the breaker |
| --- | --- | --- |
| Before `ready`, for any reason | `PROCESS_START_FAILED` | yes |
| After `ready`, not requested (crash, or a clean `exit(0)` nobody asked for) | `PROCESS_EXITED` (`intentional: false`) | yes |
| Requested — `stop()`, idle timeout, terminate-cancel | `PROCESS_EXITED` (`intentional: true`) | no |
| Fatal protocol violation | `PROCESS_PROTOCOL_ERROR` | yes |
| Handler threw | `PROCESS_REMOTE_ERROR` | no — and it *resets* the count |

A child that exits cleanly without being asked is a defect, not a graceful shutdown; it counts.

`app.on('child-process-gone')` is diagnostics only. The wrapper's `exit` event is the single source of truth for a transition — `child-process-gone` may arrive before it, after it, or (for a `kill()`) not at all.

## Cancellation

`cooperative` — main rejects the caller immediately with their own `signal.reason`, records a tombstone, and sends `cancel`. The child aborts that handler's signal with `code: 'UTILITY_PROCESS_REQUEST_CANCELLED'`; whatever terminal the handler eventually produces is dropped. Other requests are untouched.

`terminate` — main kills the generation. The canceller's promise settles with its own reason only after the exit is observed (so "cancelled" means the native call is really gone), and every other in-flight request fails with `PROCESS_EXITED { intentional: true }`. Terminate cancellations do not count against the breaker.

An `onEvent` callback that throws cancels its own request under the same policy, with the thrown error as the reason.

## Circuit breaker

Three consecutive infrastructure failures open the circuit: further requests fail immediately with `PROCESS_CIRCUIT_OPEN` and nothing is spawned. Any well-formed terminal from a healthy child — including a handler error — resets the count to zero, because it proves the fork, handshake, and dispatch path all work. `stop({ resetFailures: true })` and a successful `withStopped(op, { resetFailures: true })` clear it deliberately. A failed stop does not.

The third failure's error already carries `failureCount: 3` and `circuitOpen: true`, so a consumer can tell the user the circuit just opened without waiting for the next rejection.

## Stop budget

`stop()` sends `shutdown` (or kills outright if the generation never became ready), then waits: the child aborts its handlers, awaits them, runs `dispose`, closes the port, and exits `0`. A child that has not exited 1 s later is killed. If it has still not exited after 4 s total, `stop()` rejects with `PROCESS_STOP_FAILED`, pending requests are rejected too, and the generation stays quarantined — no successor spawns until its exit is finally observed.

Four seconds fits under the lifecycle's 5 s stop ceiling, and the manager stops every host in parallel, so the budget is 4 s in total rather than 4 s per process. The manager keeps each host until its confirmed exit — across `onStop` and a service restart — so `stop()` and `withStopped()` issued during teardown still wait for the real exit, and a quarantined child blocks a successor until it is gone.

## Errors

`UtilityProcessError` is the only error type the layer throws. `code` is the contract; `processId`, `generation`, `exitCode`, `intentional`, `failureCount`, `circuitOpen`, and `remote` are diagnostics.

| Code | Meaning |
| --- | --- |
| `PROCESS_START_FAILED` | Fork, environment, handshake, or `initialize` failed |
| `PROCESS_EXITED` | The process exited; `intentional` says whether core asked for it |
| `PROCESS_PROTOCOL_ERROR` | Either side broke the wire contract |
| `PROCESS_REMOTE_ERROR` | The handler threw; see `remote` |
| `PROCESS_SERIALIZATION_FAILED` | Input could not be cloned to the child |
| `PROCESS_BLOCKED` | A `withStopped()` window is open, or the manager is shutting down |
| `PROCESS_CIRCUIT_OPEN` | Three consecutive infrastructure failures |
| `PROCESS_STOP_FAILED` | The process did not exit within the stop budget |

A child-side clone failure never kills the process: it comes back as a `PROCESS_REMOTE_ERROR` whose `remote.code` is `PROCESS_SERIALIZATION_FAILED`. An unclonable event also aborts its handler's signal; the child keeps tracking that handler until it settles, so a shutdown still waits for it before `dispose`.
