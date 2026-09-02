# Utility Process

Runs crash-prone or untrusted work in an Electron utility process: manifest, typed clients, wire protocol, and the child-side runtime. One live process per definition, spawned on the first request.

**For the full guide, see [docs/references/utility-process/](../../../../docs/references/utility-process/).**

Quick jumps:

- [Reference](../../../../docs/references/utility-process/README.md) — declaring a process, writing an entry, the consumer recovery contract, lint boundary
- [Protocol & State Machine](../../../../docs/references/utility-process/utility-process-protocol.md) — frames, generations, cancellation, circuit breaker, stop budget
- [Testing](../../../../docs/references/utility-process/utility-process-testing.md) — unit layers and the real-Electron smoke harness
- [Future Work](../../../../docs/references/utility-process/utility-process-future.md) — what V1 leaves out, and the consumer order
- [Design RFC](../../../../docs/references/architecture/utility-process-rfc.md) — rationale, alternatives, experiment evidence

This directory has **no barrel**: main-side and child-side code are bundled into different processes, so a root `index.ts` would seal `runtime/` behind a boundary the child build has to cross. Import the sanctioned paths directly:

| From | Import |
| --- | --- |
| A consumer service | `./types`, `./defineUtilityProcess`, `./UtilityProcessError` |
| An entry (`utilityEntries/**`) | `./runtime/serveUtilityProcess` |
| The manifest | `./types` (definitions live with their consumer) |

`host/`, `UtilityProcessManager.ts`, and `installedManifest.ts` are internal — `UtilityProcessManager` is reached through `application.get('UtilityProcessManager')`, never imported by child code.
