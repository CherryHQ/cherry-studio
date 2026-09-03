---
description: How core/utilityProcess is verified — unit contracts against an in-memory adapter and the manual real-Electron smoke harness
sources:
  - src/main/core/utilityProcess
  - scripts/utility-process-smoke
---

# Testing Utility Processes

## Three layers

1. **Child runtime, no host** — `serveUtilityProcess.test.ts` drives the real runtime through a fake `parentPort`: ready ordering, terminal shape, violations and their exit codes, cancellation, shutdown.
2. **Host engine, no Electron** — the four `ProcessHost.*.test.ts` files drive the real engine through an in-memory adapter: lifecycle, cancellation and protocol violations, the breaker, and the stop/`withStopped` barriers. Timers are faked, so the 10 s ready timeout and the 4 s stop budget cost nothing.
3. **Real Electron, manual** — `pnpm smoke:utility-process` builds a throwaway app and runs it twice on real processes.

Layers 1 and 2 run in CI as ordinary Vitest tests:

```bash
pnpm exec vitest run --project main src/main/core/utilityProcess
```

## The adapter seam

`ProcessAdapter` is the only thing between the engine and `utilityProcess.fork`: spawn returns a handle with `connect` / `send` / `kill` and the five listener registrations. The in-memory implementation (`__tests__/memoryProcessAdapter.ts`) passes frames through `structuredClone` on a fake port pair and delivers them on microtasks, so unclonable payloads raise a real `DataCloneError` and no test has to reason about a bundle. A test child either binds the real runtime (`child.serve(...)`) or scripts raw frames (`reply` / `post` / `onFrame`) for fault injection.

Because the engine takes `{ adapter, logger, resolveEntry, getTempDir }` and imports neither `@application` nor `@logger`, the same engine runs unmodified in unit tests and in the smoke harness.

## Smoke harness

```bash
pnpm smoke:utility-process
```

It builds `local/utility-process-smoke/app` with two electron-vite passes — `out/main/index.js` and `out/utility-process/<entry>.js` — asserts the entry bundles are hermetic, runs the app unpacked, packs it into `app.asar`, and runs it again. Evidence lands in `local/utility-process-smoke/evidence/` (`summary.json`, one NDJSON log per variant, the asar manifest).

The harness drives `ProcessHost` with the real Electron adapter but does **not** boot the lifecycle container. Everything that needs a real process lives in `host/` and `runtime/`; the manager is DI glue covered by unit tests, and booting the container would drag winston, BootConfig, and quit handlers into a throwaway app for no added coverage.

`resolveEntry` in the harness is deliberately the same join as the `app.utility_process` path key, so the asar run also proves the production path composition works inside an archive.

The harness covers **only what a real process can prove**. Request correlation, cancellation policy, the breaker, and the stop barriers are unit tests against the in-memory adapter and are deliberately not repeated here — running them twice costs maintenance and proves nothing new.

| Check | What only a real process proves |
| --- | --- |
| `entry-isolation` | Each definition resolves and forks its own bundle, and the connect handshake accepts it — including from inside the asar |
| `typed-array-4mib` | A 4 MiB `Uint8Array` survives real cross-process cloning with its checksum |
| `stop-stuck-kill` | A real `kill()` terminates a handler that ignores its abort signal |
| `stop-before-spawn` | A `stop()` issued before Electron's `spawn` event still ends the process as an intentional exit |
| `crash-recovery` | `process.abort()` kills only the child; a replacement process serves the next request |
| `stdio-log-relay` | Child stdout and stderr really reach the host through the pipe, alongside `log` frames |
| `net-proxy` | `electron.net.fetch()` in the child honours `app.setProxy()` |

The build assertions matter as much as the checks: the runner rejects any `require()` in an entry bundle that is not relative, `electron`, or a Node builtin, and greps both trees for `LoggerService` / `winston` / `ServiceContainer`.

`process.abort()` exit codes are platform-specific, so `crash-recovery` only asserts a non-zero code. Anything that reads a pipe rather than the message port (stdout/stderr) is polled with a deadline instead of asserted immediately — the pipe is not synchronised with the port, and asserting an order that does not exist would only produce a flaky gate.

One thing the harness does **not** currently catch: entry bundles folding into one another. That failure mode (RFC §9, E1) needs a main entry in the same rollup graph as the utility entries; the harness builds them in two separate passes, so it cannot arise — verified by rebuilding with `preserveModules: false`, which still emits two independent entries and still passes. A consumer that adds its entries to the main build reintroduces the risk and owes its own check.

## Scope and residual risk

The harness has been run on macOS (darwin-arm64) only. Proxy inheritance, `process.abort()` behaviour, and kill semantics are the platform-sensitive parts; **the first consumer PR owes a Windows and Linux re-run** before its process ships to users. Until then the layer is exercised only by the empty manifest.

The harness is a manual gate, not part of `pnpm test`: it builds two bundles and launches Electron twice. Wiring it into CI is worth doing when the first consumer lands, gated on changes under `src/main/core/utilityProcess/**`.

There is no performance gate. Fork cost, handshake latency, and large-payload throughput vary far too much across machines to assert; measure them per consumer, against that consumer's own workload.

## Writing tests for a consumer

Test a consumer's handlers as plain functions — they are ordinary async functions with a `signal` and an `emit`. Do not spawn a real process in unit tests, and do not mock `ProcessHost`: inject a fake client (`request` / `stop` / `withStopped`) and assert what the consumer does with each `UtilityProcessError.code`. The recovery contract is the consumer's own behaviour, and the codes are the contract to test against.
