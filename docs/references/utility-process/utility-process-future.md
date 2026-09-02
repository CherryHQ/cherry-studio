---
description: What core/utilityProcess V1 leaves out on purpose, in what order it should land, and when a worker thread is the better answer
sources:
  - src/main/core/utilityProcess
  - src/main/services/readableContent/ReadableContentService.ts
---

# Utility Process Future Work

V1 ships the narrowest layer that lets the first consumer stop hand-rolling process management. Everything here is deliberately absent, and everything here is **additive**: a new field on `defineUtilityProcess()` or a new option on `request()`, never a change to what an existing definition means. A consumer written against V1 keeps working unchanged.

## Deferred capabilities

**Keyed instances** — one process per key (per model, per workspace) instead of per definition. The engine already isolates state per generation; keying multiplies the host map, adds an eviction policy, and needs a per-key idle budget. Wait until a consumer genuinely needs two live instances at once.

**Ephemeral processes** — fork, run one request, exit. A `lifetime: 'ephemeral'` variant for the sandboxed-evaluation case, where reuse is a security liability rather than a saving.

**Pooling** — a warm pool for latency-sensitive spawns. Only worth it once a consumer measures fork cost as a real problem; `WindowManager`'s pool is the precedent for what that costs in complexity.

**Reverse RPC (child → main)** — a child asking main to read a file or resolve a path. It inverts the trust direction, so it needs its own allow-list rather than a generic channel. `log` frames cover the diagnostic half of the need today.

**Raw byte channel** — a side channel for streaming binary data without structured clone. Structured clone already moves 4 MiB fine; revisit only against a measured throughput problem.

**Runtime payload validation** — main and child ship in the same signed build, so V1 validates the envelope, not the payload. If a future consumer loads third-party entry code, that assumption breaks and the contract needs a schema.

**Automatic restart and retry** — the layer restarts the process, not the work; consumers decide. A future `restart: 'eager'` could keep a warm process alive for latency, but "who retries the request" must stay the consumer's call.

**CI smoke gate** — see the [testing doc](./utility-process-testing.md): worth wiring up when the first consumer lands, path-gated on this module.

## Consumer order

1. **`InferenceServiceBase`** (embedding / OCR) — the reason this layer exists. It hand-rolls a pending map, generation guards, an idle timer, and a `terminateThen` maintenance gate; all four are now generic. It also proves the `terminate` policy against a native call.
2. **Code-mode sandbox** — the security case: a hermetic environment and per-request isolation, and the first likely user of ephemeral processes.
3. **Screenshot window enumeration** — a small, blocking native call; a good test of whether the layer is pleasant for something that is *not* a long-lived runtime.

Each migration deletes hand-rolled process management rather than adding a wrapper around it. If a migration cannot delete anything, that is a signal the layer is missing something — file it here.

## Process or thread?

A utility process is the answer when the work can crash the main process, needs its own environment or native libraries, or must be killable. It is not free: a fork, a handshake, and a structured-clone hop per call.

When the work is pure CPU on data that is already in main's memory — HTML parsing, text extraction, hashing — a worker thread is cheaper and simpler. `ReadableContentService` is the standing example: it uses a `?nodeWorker` thread and should stay one. Do not migrate a thread to a process without a crash-isolation or environment reason.
