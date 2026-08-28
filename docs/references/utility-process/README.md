---
description: Entry point for core/utilityProcess — what the layer owns, how a consumer declares and calls a utility process, and the boundaries lint enforces
sources:
  - src/main/core/utilityProcess
  - src/main/core/paths/pathRegistry.ts
  - electron.vite.entries.config.ts
---

# Utility Process Reference

`src/main/core/utilityProcess/` runs trusted but crash-prone work in an Electron utility process instead of the main process: native model runtimes, third-party binaries, anything that can take the main process down with it. It owns spawning, the wire protocol, request correlation, cancellation, failure classification, and shutdown — a consumer writes a contract, an entry, and calls typed methods. The process is a crash and native-library isolation boundary, not a security sandbox: the child is a full Node context with no capability or OS-level restriction, so V1 must not run untrusted code.

The design rationale, the rejected alternatives, and the experiment evidence live in the [design RFC](../architecture/utility-process-rfc.md).

## Quick Navigation

- [Protocol & State Machine](./utility-process-protocol.md) — frames, handshake, generations, cancellation, circuit breaker, stop budget
- [Testing](./utility-process-testing.md) — the three verification layers and the real-Electron smoke harness
- [Future Work](./utility-process-future.md) — what V1 deliberately leaves out, and in what order it lands

## What V1 is not

No pooling, no keyed instances, no reverse RPC (child → main), no raw byte channel, no runtime schema validation, and no automatic restart. One live process per definition, spawned on the first request. Three processes are registered today — `inference.embedding`, `inference.ocr` and `inference.asr` (local embedding, OCR and speech recognition).

## Declaring a process

A definition is a frozen, validated description of one utility process. It carries the contract only as a phantom type — main and child come from the same signed build, so there is no runtime validation of method payloads.

```typescript
// src/main/ai/localModel/runtime/inferenceProcess.ts
export type EmbeddingInferenceContract = {
  methods: {
    embed: UtilityProcessMethod<{ modelDir: string; dtype: string; texts: string[] }, number[][]>
  }
}

export const embeddingInferenceProcess = defineUtilityProcess<EmbeddingInferenceContract, InferenceInitData>({
  id: 'inference.embedding',
  entry: 'inference-embedding',
  cancellation: 'cooperative',
  idleTimeoutMs: 60_000,
  createInitData: () => createInferenceInitData('embedding')
})
```

- `id` — lowercase dotted identity; also the process's `serviceName` (`CherryStudio.UtilityProcess.<id>`), which is what Activity Monitor and `child-process-gone` report.
- `entry` — kebab-case build key. Core resolves `app.utility_process` + `<entry>.js`, i.e. `out/utility-process/<entry>.js` inside the app bundle (read-only, never auto-created).
- `cancellation` — `cooperative` aborts the handler's signal; `terminate` kills the whole generation. Pick `terminate` when the work is a native call that cannot be interrupted.
- `createEnv` / `createInitData` — evaluated per generation. `createInitData` may be async; it is awaited while the process launches, so a slow factory spends the same 10 s budget the handshake does. The environment is additive only (see below).

Register the definition from the consumer service's `onInit` — `application.get('UtilityProcessManager').register(definition)` under `@DependsOn(['UtilityProcessManager'])` (the manager is `Phase.WhenReady`; the dependency orders the two). Registering the same object again is a no-op, which keeps a service restart safe; a different object with the same id is refused. `client()` accepts only registered objects, so an unregistered definition fails loudly there rather than silently spawning.

## Writing the entry

Entries live in a `utilityEntries/` directory next to their consumer and end with `serveUtilityProcess()`:

```typescript
// src/main/ai/localModel/runtime/utilityEntries/inferenceEmbedding.ts
serveUtilityProcess<EmbeddingInferenceContract, InferenceInitData>({
  id: 'inference.embedding',
  initialize: (initData, { logger }) => applyInitData(initData, logger),
  handlers: embeddingHandlers,
  dispose: ({ logger }) => disposeCachedResources(logger)
})
```

Keep the entry file itself to that call and put the handlers in a sibling module (`inferenceEmbeddingHandlers.ts`): importing an entry executes `serveUtilityProcess()`, which needs a real `process.parentPort`, so handler logic in the entry file cannot be unit-tested.

Register the entry in `electron.vite.entries.config.ts` under the same key its definition names — the key becomes the emitted `<entry>.js`. That config is a **second build pass** (`pnpm build:utility-process`, run by `pnpm build` and `pnpm dev`) because each entry is a standalone bundle for a fresh Node runtime, not a chunk of the main bundle. Entries do not hot-reload: re-run it after changing one.

`initialize` must stay light: the host fails the cold start after 10 s. Heavy work belongs in a method the caller can cancel. Handlers receive `{ signal, emit, logger }`; `emit` streams progress, `logger` writes structured lines that the host relays with the process id, generation, pid, and request id attached. Anything the child writes to stdout/stderr is relayed too (`debug` / `warn`), so a native library's own logging is not lost.

## Calling it

```typescript
const client = application.get('UtilityProcessManager').client(embeddingProcess)
const vectors = await client.request('embed', { texts }, { signal })
```

Nothing spawns until the first `request()`. The client exposes exactly three operations — `request`, `stop`, `withStopped` — and never a fork, pid, port, or generation number.

### Consumer recovery contract

The layer restarts the process, not the work. A rejected `request()` is final: no automatic retry, no replay of in-flight requests. Consumers decide what a failure means for them, keyed on `UtilityProcessError.code`:

- `PROCESS_START_FAILED` / `PROCESS_EXITED` / `PROCESS_PROTOCOL_ERROR` — infrastructure failed. Surface it; the next `request()` spawns a fresh generation.
- `PROCESS_REMOTE_ERROR` — the handler threw. Business failure; `error.remote` carries the child's `name` / `message` / `code`.
- `PROCESS_CIRCUIT_OPEN` — three consecutive infrastructure failures. Stop retrying and tell the user; clear it deliberately with `stop({ resetFailures: true })` after fixing the cause (re-downloading a model, for example).
- `PROCESS_BLOCKED` — a `withStopped()` maintenance window is open. Retry after it completes.
- `PROCESS_SERIALIZATION_FAILED` — the input is not structured-cloneable. A programming error, not a runtime condition.

Cancellation is not a `UtilityProcessError`: the caller's own `signal.reason` is rethrown untouched.

### Maintenance

`withStopped(operation)` is the file-replacement gate: it stops the live process, runs `operation` only after a confirmed exit, and fails concurrent requests with `PROCESS_BLOCKED` meanwhile. Use it to delete or overwrite files the child holds open (a model directory on Windows, for instance). `stop()` alone is the short barrier — the next request lazily respawns.

## Environment and network

The child environment is a hermetic baseline, not a copy of the parent: `NODE_ENV`, `PATH`, locale and timezone variables, and `TMPDIR`/`TEMP`/`TMP` pointed at Cherry's own temp directory, plus the platform variables a child cannot start without (`SYSTEMROOT` and friends on Windows, `LD_LIBRARY_PATH`/`APPIMAGE`/`APPDIR`/`OWD` on Linux). `HOME`, user profile paths, proxy variables, and tokens are never passed. `createEnv()` may only add: overriding a baseline key, or touching `NODE_*`, `ELECTRON_*`, `CHERRY_UTILITY_PROCESS_*`, `LD_*` or `DYLD_*`, throws.

Utility processes are Node contexts with Electron's `net` module available, so `electron.net.fetch()` inherits the app's proxy configuration. Prefer it over `undici`/`fetch` for anything that must honour the user's proxy settings.

## Lint boundary

Child code is bundled for a process with no lifecycle container, no logger, and no database. `eslint.config.mjs` fences four globs — `core/utilityProcess/protocol/**`, `core/utilityProcess/runtime/**`, `src/main/**/utilityEntries/**`, and the smoke harness entries — with an `import-x/no-restricted-paths` zone resolved against `tsconfig.node.json`: `@application`, `@logger`, `@data/*`, and any relative path into `core/application`, `core/lifecycle`, `core/logger`, `core/paths`, `data`, `ipc`, or the host half of this module (`host/**`, `UtilityProcessManager`) are judged by where they resolve, not by how they are spelled.

That rule only sees direct imports. The transitive case — an innocent helper that pulls in `@logger` three modules down — is caught at build time by `scripts/utilityProcessEntryGuard.ts`, installed by both the production entries build and the smoke harness. To check a boundary by hand:

```bash
pnpm exec eslint --stdin --stdin-filename src/main/core/utilityProcess/runtime/probe.ts < probe.ts
```
