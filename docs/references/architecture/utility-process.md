---
description: Architecture of the utility-process subsystem — ownership, lifecycle boundaries, build isolation, design decisions, and historical experiment evidence
sources:
  - src/main/core/utilityProcess
  - src/main/core/application/serviceRegistry.ts
  - src/main/core/paths/pathRegistry.ts
  - src/main/services/proxy/ProxyService.ts
  - src/main/services/readableContent/ReadableContentService.ts
  - scripts/utility-process-smoke
  - electron.vite.config.ts
  - electron.vite.entries.config.ts
  - scripts/utilityProcessEntryGuard.ts
  - src/main/ai/localModel/runtime/inferenceProcess.ts
---

# Utility Process Architecture

This is the architecture reference for `src/main/core/utilityProcess/`, implemented in
[#19660](https://github.com/CherryHQ/cherry-studio/pull/19660) for
[#19621](https://github.com/CherryHQ/cherry-studio/issues/19621).
It owns subsystem boundaries and design rationale. The references below own the detailed
contracts; declarations are linked to source instead of duplicated here.

| Concern | Authoritative reference |
| --- | --- |
| Definitions, registration, entry examples, recovery, environment | [Consumer guide](../utility-process/README.md) |
| Public TypeScript types and contract inference | [types.ts](../../../src/main/core/utilityProcess/types.ts) |
| Frames, cancellation, failure accounting, stop budget, maintenance | [Protocol & State Machine](../utility-process/utility-process-protocol.md) |
| Unit tests, real-Electron smoke, production integration requirements | [Testing](../utility-process/utility-process-testing.md) |
| Deferred capabilities and consumer migrations | [Future Work](../utility-process/utility-process-future.md) |

## Scope and ownership

The subsystem runs trusted but crash-prone work in Electron utility processes. It owns
process spawning, the readiness handshake, request correlation, events, cancellation delivery,
generation lifetime, logging, idle release, and infrastructure failure accounting.

A utility process isolates crashes and native-library state. It is a full Node context,
**not a security sandbox**; untrusted evaluation requires a separate permission and restricted-process model.

| Owner | Responsibilities |
| --- | --- |
| Consumer service | Definition and entry source, business handlers, model loading, request concurrency/queueing, request deadlines, retries, UI error handling |
| `UtilityProcessManager` | Definition registration, stable clients, one host per definition, lifecycle shutdown, retaining maintenance ownership across restart |
| `ProcessHost` | Generations, request settlement, startup/stop deadlines, circuit breaker, idle TTL, the serialized maintenance queue |
| Electron adapter | Fork, private message channel, wrapper exit events, stdout/stderr relay |
| Child runtime | Envelope validation, handler dispatch, abort signals, error normalization, tracking handlers through shutdown |

```mermaid
flowchart LR
  DOMAIN["Consumer service"] -->|register definition| MANAGER["UtilityProcessManager"]
  DOMAIN --> CLIENT["Stable typed client"]
  CLIENT --> MANAGER
  MANAGER --> HOST["ProcessHost per definition"]
  HOST --> ADAPTER["Electron adapter"]
  ADAPTER <-->|private MessagePort| RUNTIME["Child runtime"]
  RUNTIME --> HANDLERS["Domain handlers"]
```

The generic layer does not register business definitions itself. The local-model domain registers
embedding and OCR processes, with a separate production entry build. The forcing constraint is the Windows
ONNX Runtime DLL collision described in #19621: incompatible native runtimes must not share a process.
Embedding, OCR, and speech remain consumer-owned capabilities.

## Registration and public API

The manager is a `Phase.WhenReady` lifecycle service. A consumer registers its frozen definition
from `onInit` under `@DependsOn(['UtilityProcessManager'])`, then obtains a cached client.
Registration is idempotent for the same definition object and rejects a different object with
the same id. Domains own their definitions; no central mutable manifest or manual install step
in `main.ts` is required.

The public client exposes `request`, `stop`, and `withStopped`. It does not expose forks,
pids, ports, generation counters, or status events. The first request starts the process;
concurrent cold-start callers share the readiness barrier.

The canonical [type declarations](../../../src/main/core/utilityProcess/types.ts) constrain
contracts with `UtilityProcessContract`, carry them through the definition's `__contract`
phantom member, and restrict method keys to strings. These are compile-time relationships,
not runtime payload validation. Main and child come from the same build; the versioned envelope
detects incompatible bundles.

`initialize` wires paths and lightweight state. Model loading belongs in a cancellable handler
or lazy handler-owned initializer: it must not consume the fixed readiness deadline.
See the [entry example](../utility-process/README.md#writing-the-entry).

## Resource lifetime and maintenance

The wrapper's `exit` event is the lifecycle truth. Sending shutdown, closing the message port,
or receiving `child-process-gone` diagnostics does not prove file handles have been released.
A timed-out stop retains the old generation and prevents a successor until exit is confirmed.

A host also owns work that outlives the child: the queued and running `withStopped` operations.
The manager retains that host across stop/restart until **both** the process has exited and the
maintenance queue has drained. Retirement is synchronous with the final exit/maintenance
transition, so a newly queued operation cannot lose its owner between the idle check and removal.

Maintenance submitted while the manager is stopped uses the same per-definition host queue,
even when no child exists. New requests fail with `PROCESS_BLOCKED` while stopped or while
maintenance is queued/running. A failed maintenance callback releases its gate and propagates
its original error; later queued callbacks still run in order.

Lifecycle shutdown waits only for the bounded process-stop operation. An unbounded file
maintenance callback can keep its host retained, but does not extend the process-stop budget.
The exact deadlines and error codes live in the
[protocol reference](../utility-process/utility-process-protocol.md#stop-budget).

## Design decisions

- **Processes only.** Threads and processes have different crash isolation, termination,
  memory-release, and diagnostics semantics. A dual backend would leak those differences into
  consumers. `ReadableContentService` remains the file-entry `?nodeWorker` precedent for
  short-lived work that does not need process isolation.
- **Mechanism in core, request policy in consumers.** Startup and stop deadlines bound resource
  lifecycle; business request deadlines, queues, concurrency limits, retries, and backpressure
  remain consumer-owned. No worker-initiated RPC or status API is added without a consumer.
- **No request replay or eager restart.** Infrastructure failure ends the affected requests.
  A later request may spawn a new generation; the breaker prevents deterministic crash loops.
  Explicit reset follows remediation. Consumer-facing recovery is specified in the
  [recovery contract](../utility-process/README.md#consumer-recovery-contract).
- **Structured clone, envelope guards.** The protocol validates identity and frame shape, not
  business payload schemas. Transfer lists and zero-copy payloads are deferred.
- **Network behavior is explicit.** Core does not depend on `ProxyService`. Networked children
  use `electron.net` to follow `app.setProxy()`; Node `fetch`, `http`, and undici are not
  covered by that guarantee. Offline inference does not need proxy state.
- **Hermetic environment and central paths.** The adapter receives fixed fork options and a
  non-empty environment baseline. Consumers obtain absolute business paths in main and pass
  cloneable init data; the manager resolves entry bundles through
  `application.getPath('app.utility_process', entry + '.js')`.
- **Separate main and child import surfaces.** There is no root barrel joining them.
  The [source README](../../../src/main/core/utilityProcess/README.md) lists the sanctioned paths.
  A resolved-path `import-x/no-restricted-paths` lint zone catches both relative and aliased
  direct imports into main-only modules; the production and smoke builds share an entry-graph guard
  in `scripts/utilityProcessEntryGuard.ts` that checks transitive imports.

## Entry build and production integration

Utility entries are ordinary TypeScript modules under their consumer's `utilityEntries/`.
The chosen build uses a dedicated electron-vite pass with named `build.lib.entry` inputs,
CJS output under `out/utility-process/`, and stable `[name].js` entry filenames.
Production and smoke builds use flat chunks with stable entry names and hashed shared-chunk names,
avoiding dependency output under nested `node_modules` directories that packaging can exclude.

Keeping main startup outside the utility build graph prevents entries from importing and
executing the app's main entry. The historical mixed-graph E1 failure below motivates that
separation; the current separate-pass smoke does not prove that `preserveModules` alone
prevents entry folding.

The generic layer provides the path key; `electron.vite.entries.config.ts` supplies the inference
entry map and reuses main's externalization policy. `pnpm build` builds entries after main, and
`pnpm dev` builds them before startup. Entry changes are not watched: rerun `pnpm build:utility-process`
after editing them. `electron-builder.yml` includes the output, but consumers must still verify the
real release-shaped package and platform checks in the [production integration checklist](../utility-process/utility-process-testing.md#scope-and-residual-risk).
A build entry map is distinct from runtime consumer registration.

The rejected `?modulePath` mechanism and selected dedicated build were measured on the exact
toolchain below. These are historical results, not claims about every future toolchain version.

## Historical experiment evidence (2026-08-28)

Experiment host: Apple M4, macOS 26.2. Checkout at commit
`98db3e04492d4977c772ef52daace3d941f4c3b4`. Pinned versions measured by the harness: Node
24.11.1, pnpm 11.8.0, Electron 41.8.0, electron-vite 5.0.0, rolldown-vite 7.3.0.
`pnpm install --frozen-lockfile` completed before every accepted run.

At final evidence review, that checkout was a diverged branch rather than current
`upstream/main` (`caf01a12bb8d652c4d6532d43009cd4c20b8cec7`). This does not change the E1/E2
result: the fixture imports no product source, all five experiment-sensitive tool versions above
are identical at both commits, and the intervening product `electron.vite.config.ts` difference is
an unrelated preload entry. The first-consumer rerun required by the production integration checklist remains the release-shaped
validation against its then-current base.

The checkout lives under macOS Documents File Provider and had only 1.9–2.2 GiB free. Several
installed build files initially carried the `dataless` flag, so early attempts spent minutes in
filesystem reads or lost the esbuild child service. Those runs are retained as environment
evidence but are not used to judge either mechanism. The conclusive runs copied the fixture and a
minimal, exact-version toolchain outside Documents; the Electron runtime still came from the
checkout.

### E1: dedicated entry build

- Isolated `?modulePath` build, default lib formats: failed in 10 ms because the nested build
  included UMD/IIFE without `build.lib.name`.
- Isolated `?modulePath` build with explicit CJS format: failed in 15 ms inside electron-vite's
  module-path plugin with `TypeError: undefined is not iterable` while consuming the nested build
  result. V1 does not patch a third-party build plugin, so a dedicated entry build was selected.
- Plain named inputs without `preserveModules`: built, but `utility-entry.js` began with
  `require('./index.js')`; the child executed main-process startup and failed. Disabling transitive
  import hoisting did not change it.
- Dedicated named-entry build with `preserveModules`: **passed** development unpacked, production
  unpacked, and production packed into a temporary ASAR. Every variant completed the versioned
  handshake, a 4 MiB `Uint8Array` round trip with checksum `524280621`, intentional
  `process.abort()` (exit code 6) without killing main, and a successful replacement-process ping.
  The ASAR contained the entry and its `_virtual/rolldown_runtime.js` dependency.

### E2: proxy inheritance

In all three accepted variants, main called
`app.setProxy({ mode: 'fixed_servers', ... })`, the utility child called
`electron.net.fetch('http://utility-process-smoke.invalid/e2')`, and the local proxy observed that
absolute URL and returned status 200 / body `utility-proxy-ok`. This is therefore a measured
guarantee for `electron.net`, not for Node networking APIs.

Raw evidence — environment, build, run, and ASAR logs for every accepted and rejected run,
including the fixture sources — is retained by the author outside the repository and is
available on request.
