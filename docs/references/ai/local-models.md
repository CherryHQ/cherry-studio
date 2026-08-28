---
description: Local model subsystem — the bundle catalog, verified acquisition, on-disk state, and utility-process inference over installed models
sources:
  - src/main/ai/localModel
  - src/renderer/hooks/useLocalModel.ts
  - src/shared/data/cache/cacheSchemas.ts
  - src/shared/data/presets/localModel.ts
  - src/shared/ipc/schemas/localModel.ts
---

# Local Models

Cherry Studio can run three models on the user's own machine: the knowledge-base
embedding model, the PaddleOCR text recognizer, and the Fun-ASR-Nano speech recognizer.
None ships in the installer — all are fetched on demand, together with the native runtime
each one needs.

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
│   ├── InferenceServiceBase.ts    ← typed process client, request queue, config restarts
│   ├── inferenceProcess.ts        ← contracts, definitions, per-generation init data
│   ├── inferenceAcceleration.ts   ← platform → execution provider
│   ├── protocol.ts                ← structured-clone-safe runtime profile and init data
│   └── utilityEntries/            ← standalone entries, handlers, shared child runtime
└── capabilities/
    ├── capabilityHooks.ts         ← removal behavior keyed by capability
    ├── embedding/                 ← facade, protocol, pooling, limits
    ├── ocr/                       ← facade, protocol, model paths
    └── asr/                       ← facade, protocol, model paths
```

## The catalog is the only per-model code

Everything about a model is one entry in `catalog/catalog.ts`. Nothing else in the
subsystem branches per model, which is the property that keeps a third or fourth model
from adding a third or fourth copy of the download machinery.

### Bundles

A **bundle** is what a user installs: one capability's files, fetched, verified, reported
and removed as a unit. It is the first-class citizen rather than a single file because a
capability rarely is one file — OCR needs detection weights, recognition weights and a
character dictionary; speech needs an encoder, an LLM decoder, its tokenizer and a
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
  `application.get('LocalModelService').isCapabilityReady(capability)` and never name a bundle.
- A **bundle id** is what a user installs (`pp-ocrv6-medium`). It is the addressing key of
  the whole management plane — status, download, cancel, remove and shared status snapshots.

`LOCAL_MODEL_BUNDLE_BY_CAPABILITY` maps one to the other for the few UI entry points that
must offer a download for a capability. The catalog's own test asserts that map, and the
shared id list, still match the catalog — the renderer cannot import the catalog, so this
is the seam where the two could drift. A capability has exactly one bundle today; adding
alternatives requires an explicit model-selection contract rather than relying on catalog order.

### Shared artifacts

A **shared artifact** is a native runtime published on npm — `onnxruntime-node` for
embedding and OCR, `sherpa-onnx` for speech. Bundles declare what they need in `requires`,
and that declaration is what makes a runtime removable: it outlives a bundle exactly as
long as another *installed* bundle still requires it.

npm coordinates live on the **platform** entry, not on the artifact, because both layouts
exist: onnxruntime-node ships every platform in one tarball, sherpa-onnx one package per
platform. The utility process receives each installed entry path as init data and exports it
through the environment variable read by the package patch under `patches/`.

`platforms` is a support matrix, not just a path table. A missing entry means the artifact
cannot be installed there, so every bundle requiring it reads as `unsupported` rather than
offering a download that could only fail. Current omissions are:

- **darwin-x64** for onnxruntime-node — no such build exists, so embedding and OCR are
  unavailable on Intel Macs.
- **win32-arm64** for sherpa-onnx — the package is not published. Windows x64 is supported;
  its private onnxruntime is isolated from onnxruntime-node in the ASR utility process.

### Obtaining a checksum

The mirrors publish digests, so adding a model needs no download:

- HuggingFace — `GET /api/models/<repo>/tree/main?recursive=true`, read `lfs.oid`
  (LFS files only; a small file reports a git blob SHA-1 instead and has to be hashed by
  hand, as the speech bundle's `merges.txt` was)
- ModelScope — `GET /api/v1/models/<repo>/repo/files?Revision=master`, read `Sha256`

Compare them before committing an entry. One digest can only serve a download that falls
back between mirrors if the file is byte-identical on each — true for every file in the
catalog today, and worth re-checking per file rather than assuming.

## Acquisition

The IPC boundary supplies a lazy egress-region resolver. `BundleInstaller` first registers
the cancellable attempt, then resolves it once into a China-first or global-first preference
and converts that preference into explicit model-source and registry orders. Storage and
acquisition never depend on `RegionService` or geography.

One path is then used by model files and runtime tarballs alike:

1. **Mirror fallback** (`withMirrorFallback`) — try each mirror in region order. Model
   files have three: ModelScope, hf-mirror and HuggingFace, the region default first.
   hf-mirror is a caching proxy of HuggingFace, so it serves the same paths byte for byte —
   which is what lets one digest cover both, and what keeps a repo ModelScope never
   mirrored (the speech model's) reachable from China.
2. **Stream and verify** (`streamToFileVerified`) — hash while the bytes stream by.
3. **Atomic install** — write `${dest}.tmp-<uuid>`, rename only after the digest matches.
   A writer that is aborted unlinks its own tmp file; one that dies with the process cannot,
   so `LocalModelService` cancels in-flight downloads and waits for in-flight removals in
   `onStop()`, and sweeps leftover partials from every bundle directory in `onInit()`.

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

That move is best-effort on purpose: a live inference process can hold the files open, and
the fallback (keep loading them where they are, retry on a later run) costs nothing, while
treating a failed move as "not installed" would re-download hundreds of MB that are already
on disk.

It is also all-or-nothing. A move that stops partway puts back whatever it already moved,
because an install split across both layouts leaves *neither* complete — a model entirely on
disk would then read as incomplete and be fetched again. `resolveInstalledDir` re-reads both
directories afterwards rather than trusting the attempt's own verdict, so the one case that
cannot be repaired reports "nothing installed" instead of handing out a path that has since
lost files.

## Installing and removing

`BundleInstaller` owns one bundle's lifecycle — status, download with progress,
cancellation, removal — and is generic over the catalog. `LocalModelService` creates one
installer for every catalog entry and exposes the management API, so a new bundle does not
need a second registration site. The installer's attempt remains active through shared-
artifact cleanup, and only then publishes its terminal state; retry cannot observe a failed
attempt that is still draining. It publishes `downloading` as soon as the attempt is
registered, so a pending region probe is visible and cancellable in every window.

Downloads run shared runtimes first, then the bundle's own **missing** files, on one
weighted progress scale. Two consequences worth keeping:

- Files already on disk are never re-fetched, so repairing a half-finished install — or one
  missing only its runtime — costs only what is actually missing.
- Nothing is deleted when a download fails. Every write goes through a temp file renamed
  only on completion, so a failed attempt leaves no partials, while the files already there
  may predate it entirely. Wiping them would turn a failed ~40MB runtime fetch into the loss
  of a complete ~614MB model.

What a capability contributes is narrow, and only what the generic installation layer cannot know:
refusing removal while the model is still referenced, releasing the inference process around
the delete, and any housekeeping once the files are gone.

## Removal

Removing a bundle has two independent questions, and they are answered in different places:

- **Is the bundle itself still in use?** A capability-specific concern — the embedding
  model checks whether any knowledge base still references it, and refuses if so. This
  guard belongs with the capability, not with the generic installation layer.
- **Is a shared artifact still needed?** A structural question answered from `requires`:
  the artifact goes when no other installed bundle declares it.

Both cases must release the inference process before deleting files. The process caches
native sessions with the weight files open, so on Windows an open handle makes the unlink
fail outright.

`gcSharedArtifacts()` answers the second question, and is the *only* answer: it runs after a
removal and after an interrupted download alike. Complete bundle files are the durable
liveness signal; an active attempt holds transient reservations in
`LocalModelStorageService`. Removal registers itself before touching disk, so a new attempt
either makes GC skip the artifact or waits for an already-started removal before installing.

## Runtime

Inference runs in an Electron UtilityProcess, **one OS process per capability**. Native
runtime crashes and same-named libraries are therefore isolated: embedding/OCR load
onnxruntime-node in their own processes, while speech loads sherpa's private onnxruntime in
another. Releasing OCR for model removal cannot evict an embedding request in progress.

Each capability has a lifecycle service (`EmbeddingInferenceService`,
`OcrInferenceService`, `AsrInferenceService`) over `InferenceServiceBase`. The service checks
platform support, serializes native calls through a `concurrency: 1` queue, and restarts its
process when the proxy route or applicable acceleration profile changes. It exposes
`terminateThen()` as the maintenance barrier used before replacing or deleting model files.

`core/utilityProcess` owns lazy spawn, request correlation, cancellation, idle release after
60 seconds, crash classification, and shutdown. See [Utility Process Reference](../utility-process/README.md).

### Protocol

`runtime/inferenceProcess.ts` declares one `UtilityProcessContract` and process definition per
capability. Each method pairs one input with one output, so callers and handlers share exact
types without a union of optional result fields. Capability payload types stay beside their
facades under `capabilities/<name>/protocol.ts`.

At process handshake, `InferenceInitData` supplies the app root, installed artifact entry
paths, runtime profile, and a proxy-routing snapshot. The child applies those before lazily
loading a native package. Requests and responses use the generic UtilityProcess wire
protocol; remote handler errors are unwrapped by `InferenceServiceBase` for callers.

### Utility-process entries

Each capability has a standalone entry and a separately testable handler under
`runtime/utilityEntries/`. The entry calls `serveUtilityProcess()`, initializes the shared
child runtime, and disposes cached native resources on exit. It is registered in both the
application manifest and `electron.vite.entries.config.ts`; `pnpm build:utility-process`
emits one bundle per fresh Node runtime.

The shared child runtime resolves native packages off the app root only after setting their
downloaded binding paths. Its build boundary forbids lifecycle, database, and main-process
service imports, keeping the process environment explicit and independently loadable.

### Hardware fallback

A process started on DirectML/CoreML that fails mid-request disposes its cached sessions,
drops to CPU **for the rest of its life**, and retries once. Staying on CPU matters: a
provider that failed once will fail again on the next cache miss, and re-discovering that
per request would pay the fallback cost every time. If CPU fails too, the error names both
failures, since "CoreML crashed" and "the model is corrupt" need different fixes.

Speech is explicitly CPU-only: sherpa-onnx names its providers itself, and CoreML measured
slower than CPU for this decoder. `AsrInferenceService` and its process init both pin the CPU
profile, so changing the acceleration preference neither changes its actual provider nor
restarts its process.

### Speech is decoded in segments

Fun-ASR-Nano's decoder holds a little under 30 seconds of audio and answers anything longer
with the empty string, so the ASR handler never hands it a whole recording. Silero VAD cuts
the audio into speech runs, each run is split again if it still exceeds the window, and the
transcript is the pieces joined back together — which is also where the segment timings a
caller gets come from. Audio that arrives at another sample rate is resampled first; a
16kHz model fed 8kHz audio does not fail, it transcribes the wrong thing.

## Management plane

Commands use one generic IPC surface (`local_model.*`), addressed by bundle id:

| Route | Purpose |
|---|---|
| `list` | Everything installable, with each bundle's capability |
| `get_status` / `download` / `cancel` / `remove` | That bundle's lifecycle |
| `get_acceleration_capability` | Whether this platform has a hardware provider |

Live state is not a second command response or a custom event. `LocalModelService` is the
only writer of the session-only Shared Cache map `local_model.statuses`; each entry contains
`status`, `percent` and an optional `errorCode`. `BundleInstaller` publishes lifecycle
changes through that facade, which merges one bundle without replacing the others.

The renderer observes the map with the read-only `useSharedCacheValue` hook. On mount,
`useLocalModel` calls `get_status` only to make Main scan the disk and publish a fresh
snapshot; it ignores the response body. Disk remains the durable fact, Shared Cache is the
cross-window projection, and an old RPC completion has no renderer state to overwrite.

The settings cards render from `list`, one card per capability bundle, with name and subtitle
read from the capability's i18n keys. Shipping a new capability therefore needs no new route
or handler, but does require the catalog, shared vocabulary and presentation described below.

## Adding a model

1. Add a `ModelBundle` to `catalog/catalog.ts` — every file with a real `sha256`
   (see [Obtaining a checksum](#obtaining-a-checksum)) and a `minBytes` floor.
2. Add its install directory to the path registry as a `feature.*` key
   (see [paths/README](../../../src/main/core/paths/README.md)).
3. If it needs a native runtime that is not already a `SharedArtifact`, add one: the npm
   package and digest per platform it can be installed on (omissions are what make a
   platform unsupported), a patch making the package load its entry file from an
   environment variable, and child-runtime setup that sets it before loading the package.
4. Add its id — and, for a new capability, that capability and its bundle mapping — to
   `src/shared/data/presets/localModel.ts`.
5. Add its removal hooks in `capabilities/capabilityHooks.ts`.
6. For a new capability, add its card icon in `LocalModelsSection` and its `name`/`subtitle`
   i18n keys.
7. For a new capability, add a directory under `capabilities/` containing its request/result
   types and facade service over `InferenceServiceBase`; add its contract, definition,
   utility-process entry and handler; then register the service, manifest entry, and build entry.

The catalog's own test suite enforces the mechanical parts (checksum present and
well-formed, keys and paths unique, `requires` resolvable), so a missed field fails in CI
rather than on a user's machine.

## Known limits

- No remote catalog. Adding a model means shipping a release; nothing fetches the model
  list at runtime.
- No streaming download resume. A failed download restarts that file from zero.
- No streaming inference. Every request is one round trip with a complete result, so a
  transcript arrives only once the whole recording is decoded; live captioning would add a
  response frame type and a streaming model.
- Speech inference is CPU-only on every platform; the global hardware-acceleration toggle
  currently applies to embedding and OCR only.
- Speech has no consumer yet. `AsrInferenceService.transcribe` is callable and the model
  installs from the settings cards, but no feature calls it.
