---
description: Local model subsystem — the bundle catalog, on-disk installation state, verified acquisition, and the worker runtime that infers over installed models
sources:
  - src/main/ai/localModel
  - src/shared/data/presets/localModel.ts
  - src/shared/ipc/schemas/localModel.ts
---

# Local Models

Cherry Studio can run two models on the user's own machine: the knowledge-base
embedding model and the PaddleOCR text recognizer. Neither ships in the installer —
both are fetched on demand, together with the native onnxruntime binary they share.

One module owns the whole path: what can be installed, how bytes get onto disk safely,
how they come off again, and how inference runs over them once they are there.

## Layout

```text
src/main/ai/localModel/
├── index.ts                       ← the module's public API; import through it
├── LocalModelService.ts           ← management facade: list/status/download/remove/readiness/GC
├── catalog/
│   ├── types.ts                   ← ModelBundle, SharedArtifact, InstallState
│   └── catalog.ts                 ← the single source of truth: every bundle and artifact
├── acquisition/
│   ├── modelSource.ts             ← HuggingFace / ModelScope mirror table
│   ├── downloadEngine.ts          ← mirror fallback, streaming + sha256, atomic writes
│   ├── bundleDownload.ts          ← a bundle's files: mirror order, weighted progress
│   ├── derivations.ts             ← transforms applied to a fetched file before it lands
│   └── tarballArtifact.ts         ← npm-published native runtimes
├── installation/
│   ├── LocalModelStorageService.ts ← disk state, installed paths, shared artifacts
│   └── BundleInstaller.ts          ← one bundle's download/cancel/remove lifecycle
├── runtime/
│   ├── InferenceServiceBase.ts    ← the worker host: spawn, queue, idle release, teardown
│   ├── inferenceAcceleration.ts   ← platform → execution provider
│   ├── protocol.ts                ← generic init/request/result/error envelopes
│   └── worker/                    ← capability-neutral worker core and source builder
└── capabilities/
    ├── capabilityHooks.ts         ← removal behavior keyed by capability
    ├── embedding/                 ← facade, protocol, pooling, worker module, limits
    └── ocr/                       ← facade, protocol, model paths, worker module
```

## The catalog is the only per-model code

Everything about a model is one entry in `catalog/catalog.ts`. Nothing else in the
subsystem branches per model, which is the property that keeps a third or fourth model
from adding a third or fourth copy of the download machinery.

### Bundles

A **bundle** is what a user installs: one capability's files, fetched, verified, reported
and removed as a unit. It is the first-class citizen rather than a single file because a
capability rarely is one file — OCR already needs detection weights, recognition weights
and a character dictionary, and a speech model would need its own acoustic model plus a
voice-activity detector.

Each `BundleFile` carries:

| Field | Purpose |
|---|---|
| `key` | Stable name for addressing one file (`detection`, `dictionary`, …) |
| `relPath` | Where it lands under the bundle's install dir; may nest |
| `repo` / `remoteFile` | What to fetch, resolved against a mirror at download time |
| `sha256` | Digest of the **fetched** bytes, verified while streaming |
| `minBytes` | Floor for the **installed** file, used by the disk scan |
| `weight` | Share of the bundle's progress bar (≈ file MB) |
| `derivation` | Optional transform applied before the bytes land |

`sha256` and `minBytes` describe different things whenever a `derivation` is present: the
OCR dictionary is fetched as the recognition model's `inference.yml` (digest checked) and
written as a parsed `ppocrv6_dict.txt` (size floor checked).

### Capabilities and bundles

Two words, deliberately distinct, both declared in `src/shared/data/presets/localModel.ts`
so the renderer can speak them too:

- A **capability** is what a feature needs (`ocr`). Features gate on
  `localModelService.isReady(capability)` and never name a bundle.
- A **bundle id** is what a user installs (`pp-ocrv6-medium`). It is the addressing key of
  the whole management plane — status, download, cancel, remove, progress events.

`LOCAL_MODEL_BUNDLE_BY_CAPABILITY` maps one to the other for the few UI entry points that
must offer a download for a capability. The catalog's own test asserts that map, and the
shared id list, still match the catalog — the renderer cannot import the catalog, so this
is the seam where the two could drift.

### Shared artifacts

A **shared artifact** is a native runtime published as an npm package — today only
`onnxruntime-node`. Bundles declare what they need in `requires`, and that declaration is
what makes the runtime removable: it outlives a bundle exactly as long as another
*installed* bundle still requires it.

`platforms` is a support matrix, not just a path table. A missing entry means the artifact
ships nothing there, so every bundle requiring it reads as `unsupported` rather than
offering a download that could only fail — which is how Intel Macs are handled, since
onnxruntime-node has no darwin-x64 build.

### Obtaining a checksum

Both mirrors publish digests, so adding a model needs no download:

- HuggingFace — `GET /api/models/<repo>/tree/main?recursive=true`, read `lfs.oid`
  (LFS files only; small files report a git blob SHA-1 instead)
- ModelScope — `GET /api/v1/models/<repo>/repo/files?Revision=master`, read `Sha256`

Compare the two before committing an entry. One digest can only serve a download that
falls back between mirrors if the file is byte-identical on both — true for every file in
the catalog today, and worth re-checking per file rather than assuming.

## Acquisition

One path, used by model files and runtime tarballs alike:

1. **Mirror fallback** (`withMirrorFallback`) — try each mirror in region order.
2. **Stream and verify** (`streamToFileVerified`) — hash while the bytes stream by.
3. **Atomic install** — write `${dest}.tmp`, rename only after the digest matches.

Two properties are worth stating because they are easy to break:

**Verification lives inside the attempt, not after the loop.** A mirror that serves a
stale, truncated or intercepted body fails exactly like an unreachable one, so the next
mirror still gets its turn. Verifying after the loop would let one bad-but-reachable
mirror make the whole download terminal.

**Abort is not a mirror failure.** A cancelled download stops at the current attempt
instead of walking the remaining mirrors re-issuing requests that would be aborted too.

The digest also replaced the size floor the download path used to depend on: a floor
cannot catch a corrupted body of the right length, while a digest catches truncation,
LFS pointers and captive-portal pages as a side effect.

## Install state comes from disk

`LocalModelStorageService` derives state by scanning, and stores nothing. A recorded flag drifts
the moment a user clears a directory behind the app's back, and recovering from "the
database says installed, the disk disagrees" is worse than the scan it would save.

Scanning checks existence and `minBytes` — never `sha256`. Hashing ~700MB of weights on
every status query would trade a correct answer for an unusable one; checksums are enforced
where the bytes arrive instead. The floor still catches the case that matters: a truncated
stub left by a killed download from before checksums existed, which would otherwise read
as a complete model and fail at load time.

Bundle files and shared artifacts are scanned separately, and callers compose them. A
bundle whose weights are complete but whose runtime is missing is an offer to download
~40MB, not a broken install — so it reports as not-installed rather than as an error.

### Superseded layouts

A bundle may declare a `legacyInstallSubdir` alongside its current one. `resolveInstalledDir`
prefers the current layout, falls back to the legacy directory, and — when only the legacy
copy exists — tries once to move the files into place.

That move is best-effort on purpose: a live inference worker can hold the files open, and
the fallback (keep loading them where they are, retry on a later run) costs nothing, while
treating a failed move as "not installed" would re-download hundreds of MB that are already
on disk.

## Installing and removing

`BundleInstaller` owns one bundle's lifecycle — status, download with progress,
cancellation, removal — and is generic over the catalog. `LocalModelService` creates one
installer for every catalog entry and exposes the management API, so a new bundle does not
need a second registration site.

Downloads run shared runtimes first, then the bundle's own **missing** files, on one
weighted progress scale. Two consequences worth keeping:

- Files already on disk are never re-fetched, so repairing a half-finished install — or one
  missing only its runtime — costs only what is actually missing.
- Nothing is deleted when a download fails. Every write goes through a temp file renamed
  only on completion, so a failed attempt leaves no partials, while the files already there
  may predate it entirely. Wiping them would turn a failed ~40MB runtime fetch into the loss
  of a complete ~614MB model.

What a capability contributes is narrow, and only what the generic installation layer cannot know:
refusing removal while the model is still referenced, releasing the inference worker around
the delete, and any housekeeping once the files are gone.

## Removal

Removing a bundle has two independent questions, and they are answered in different places:

- **Is the bundle itself still in use?** A capability-specific concern — the embedding
  model checks whether any knowledge base still references it, and refuses if so. This
  guard belongs with the capability, not with the generic installation layer.
- **Is a shared artifact still needed?** A structural question answered from `requires`:
  the artifact goes when no other installed bundle declares it.

Both cases must release the inference worker before deleting files. The worker caches
native sessions with the weight files open, so on Windows an open handle makes the unlink
fail outright.

`gcSharedArtifacts()` answers the second question, and is the *only* answer: it runs after a
removal and after an interrupted download alike. Those two paths used to disagree — removal
counted only installed bundles — so deleting one model could pull the runtime out from under
a download that was at that moment waiting for it. A bundle counts as needing its artifacts
while it is installed **or** downloading.

## Runtime

Inference runs in a `worker_threads` worker, **one per capability**. Sharing a single
worker would mean that cancelling an OCR download — which must release the file handles on
its weights — also evicts the 600MB embedding pipeline an unrelated knowledge-base index is
mid-way through. Separate workers make that impossible by construction: no shared thread,
no shared pending map, no shared `terminate()`.

Each host is a lifecycle service (`EmbeddingInferenceService`, `OcrInferenceService`) over
`InferenceServiceBase`, which owns everything that is not capability-specific:

- **Lazy spawn** on the first request, and respawn when the acceleration profile or the
  proxy routing changes — a worker's execution provider is fixed at session creation.
- **One request at a time** through a `concurrency: 1` queue. A single CPU onnxruntime
  session gains nothing from concurrent calls, and this lets several callers reach the same
  instance with no other coordination.
- **Idle release** after 60s, because a loaded model holds hundreds of MB.
- **Teardown** on stop/destroy — the worker is a real OS thread that must not outlive
  shutdown.

### Protocol

`runtime/protocol.ts` owns the structured-clone-safe envelope only: init carries the
capability and an artifact-path map; requests carry `capability`, `type`, `requestId`, and
`payload`; responses carry a result, error, or log. Capability payload/result maps live
beside their facade under `capabilities/<name>/protocol.ts`, so the common runtime never
imports a union of every supported capability.

Results are typed **per request type** rather than merged into one struct of optional fields,
so a caller gets exactly its own payload. Each capability declares its own result keys, and
the host checks them on arrival: a handler that drops a field fails the request instead of
resolving a caller with `undefined` where it declared a value.

### Worker source

Each worker script is a **string**, assembled at import time from `workerCore` plus exactly
one capability module and run with `eval: true`. It is not a separate entry file because
electron-vite bundles the main process with `inlineDynamicImports`, which cannot emit the
extra chunk a `new Worker(path)` would need.

`workerCore` knows nothing about embedding or OCR. The selected capability module registers
its request types in a `REQUEST_HANDLERS` table:

| Hook | When it runs |
|---|---|
| `handle(msg, prepared)` | Answers the request; retried once on CPU if the hardware provider fails |
| `prepare(msg)` | Setup that must **not** be retried — reading the image file, say, so a bad path is never blamed on the GPU |
| `dispose()` | Releases that capability's cached sessions when a provider is abandoned |

Adding a capability is therefore a new module, not another branch in a dispatch chain. Its
production worker cannot load another capability's dependencies because that module is not
part of its source string.

### Hardware fallback

A worker started on DirectML/CoreML that fails mid-request disposes its cached sessions,
drops to CPU **for the rest of its life**, and retries once. Staying on CPU matters: a
provider that failed once will fail again on the next cache miss, and re-discovering that
per request would pay the fallback cost every time. If CPU fails too, the error names both
failures, since "CoreML crashed" and "the model is corrupt" need different fixes.

## Management plane

One generic IPC surface (`local_model.*`), addressed by bundle id:

| Route | Purpose |
|---|---|
| `list` | Everything installable, with each bundle's capability |
| `get_status` / `download` / `cancel` / `remove` | That bundle's lifecycle |
| `get_acceleration_capability` | Whether this platform has a hardware provider |
| `download_progress` (event) | Progress, tagged with the same bundle id |

The settings cards render from `list`, one card per bundle, with name and subtitle read
from the capability's i18n keys. Shipping another model therefore touches no route, no
handler and no component — only the catalog and the shared id list.

## Adding a model

1. Add a `ModelBundle` to `catalog/catalog.ts` — every file with a real `sha256`
   (see [Obtaining a checksum](#obtaining-a-checksum)) and a `minBytes` floor.
2. Add its install directory to the path registry as a `feature.*` key
   (see [paths/README](../../../src/main/core/paths/README.md)).
3. If it needs a native runtime that is not already a `SharedArtifact`, add one and list
   every platform it ships binaries for — omissions are what make a platform unsupported.
4. Add its id — and, for a new capability, that capability and its bundle mapping — to
   `src/shared/data/presets/localModel.ts`.
5. For a new capability, add its removal hooks in `capabilities/capabilityHooks.ts`. A new
   bundle for an existing capability needs no installer registration.
6. For a new capability, add its card icon in `LocalModelsSection` and its `name`/`subtitle`
   i18n keys. An existing capability needs neither.
7. For a new capability, add a directory under `capabilities/` containing its request/result
   maps, worker module, and facade service over `InferenceServiceBase`. A new bundle for an
   existing capability needs none of this.

The catalog's own test suite enforces the mechanical parts (checksum present and
well-formed, keys and paths unique, `requires` resolvable), so a missed field fails in CI
rather than on a user's machine.

## Known limits

- No remote catalog. Adding a model means shipping a release; nothing fetches the model
  list at runtime.
- No streaming download resume. A failed download restarts that file from zero.
- No streaming inference. Every request is one round trip with a complete result; a
  transcription capability that wants partial output would add a response frame type.
- onnxruntime is the only runtime. A second one (llama.cpp, sherpa-onnx) fits the shared
  artifact and worker-module seams, but nothing exercises them yet.
