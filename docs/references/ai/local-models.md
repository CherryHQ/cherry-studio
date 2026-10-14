---
description: Local model subsystem — the bundle catalog, on-disk installation state, verified acquisition, and the worker runtime that infers over installed models
sources:
  - src/main/ai/localModel
  - src/renderer/hooks/useLocalModel.ts
  - src/shared/data/cache/cacheSchemas.ts
  - src/shared/data/presets/localModel.ts
  - src/shared/ipc/schemas/localModel.ts
---

# Local Models

Cherry Studio can run three model capabilities on the user's own machine: knowledge-base
embedding, PaddleOCR text recognition, and FunASR Nano speech recognition. Their model
bundles and required native runtimes are fetched on demand rather than shipped in the installer.

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
│   ├── InferenceServiceBase.ts    ← typed utility-process host and per-capability queue
│   ├── inferenceProcess.ts        ← process definitions, typed contracts, init data
│   ├── inferenceAcceleration.ts   ← platform → execution provider
│   ├── protocol.ts                ← child init and runtime-profile types
│   └── utilityEntries/            ← one packaged process entry and handlers per capability
└── capabilities/
    ├── capabilityHooks.ts         ← removal behavior keyed by capability
    ├── embedding/                 ← facade, protocol, pooling, model paths, limits
    ├── ocr/                       ← facade, protocol, model paths
    └── asr/                       ← facade, protocol, FunASR model paths
```

## The catalog is the only per-model code

Everything about a model is one entry in `catalog/catalog.ts`. Nothing else in the
subsystem branches per model, which is the property that keeps a third or fourth model
from adding a third or fourth copy of the download machinery.

### Bundles

A **bundle** is what a user installs: one capability's files, fetched, verified, reported
and removed as a unit. It is the first-class citizen rather than a single file because a
capability rarely is one file — OCR needs detection weights, recognition weights and a
character dictionary, while FunASR needs its encoder, LLM, embedding, tokenizer and
voice-activity detector.

Each `BundleFile` carries:

| Field | Purpose |
|---|---|
| `key` | Stable name for addressing one file (`detection`, `dictionary`, …) |
| `relPath` | Where it lands under the bundle's install dir; may nest |
| `repo` / `remoteFile` | Default repository path resolved against each mirror at download time |
| `sources` / `sizeBytes` | Audited alternative: per-mirror repository, immutable revision and path, plus exact byte length |
| `sha256` | Digest of the **fetched** bytes, verified while streaming |
| `minBytes` | Floor for the **installed** file, used by the disk scan |
| `weight` | Share of the bundle's progress bar (≈ file MB) |
| `derivation` | Optional transform applied before the bytes land |

`sha256` and `minBytes` describe different things whenever a `derivation` is present: the
OCR dictionary is fetched as the recognition model's `inference.yml` (digest checked) and
written as a parsed `ppocrv6_dict.txt` (size floor checked).

Bundles and shared artifacts may also declare `provenance`: immutable upstream and license
evidence, plus conversion provenance where downloaded bytes are derived from another model.
This metadata is for auditability; `repo` or `sources` still own the actual download locations.

### Capabilities and bundles

Two words, deliberately distinct, both declared in `src/shared/data/presets/localModel.ts`
so the renderer can speak them too:

- A **capability** is what a feature needs (`embedding`, `ocr` or `asr`). Features gate on
  `application.get('LocalModelService').isCapabilityReady(capability)` and never name a bundle.
- A **bundle id** is what a user installs (`pp-ocrv6-medium`). It is the addressing key of
  the whole management plane — status, download, cancel, remove and shared status snapshots.

`LOCAL_MODEL_BUNDLE_BY_CAPABILITY` maps one to the other for the few UI entry points that
must offer a download for a capability. The catalog's own test asserts that map, and the
shared id list, still match the catalog — the renderer cannot import the catalog, so this
is the seam where the two could drift. A capability has exactly one bundle today; adding
alternatives requires an explicit model-selection contract rather than relying on catalog order.

### Shared artifacts

A **shared artifact** is a native runtime published as an npm package. Embedding and OCR use
`onnxruntime-node`; ASR uses `sherpa-onnx`. Bundles declare what they need in `requires`, and
that declaration is what makes the runtime removable: it outlives a bundle exactly as long
as another *installed* bundle still requires it.

`platforms` is a support matrix, not just a path table. A missing entry means the artifact
ships nothing there, so every bundle requiring it reads as `unsupported` rather than
offering a download that could only fail. Each entry pins its npm package and tarball digest
and lists the files extracted for that target. `onnxruntime-node` selects a platform subtree
from one package and has no Intel Mac build; sherpa-onnx uses one package per platform and
has no Windows ARM64 build.

### Obtaining a checksum

The model registries publish digests, so adding a model needs no download:

- HuggingFace — `GET /api/models/<repo>/tree/main?recursive=true`, read `lfs.oid`
  (LFS files only; small files report a git blob SHA-1 instead)
- ModelScope — `GET /api/v1/models/<repo>/repo/files?Revision=master`, read `Sha256`

Compare every declared source before committing an entry. One digest can only serve a
download that falls back between sources if the file is byte-identical on all of them.
Files using `sources` must pin each registry revision; the source list, exact `sizeBytes`,
digest and catalog-level provenance together form the auditable acquisition record.

## Acquisition

The IPC boundary supplies a lazy egress-region resolver. `BundleInstaller` first registers
the cancellable attempt, then resolves it once into a China-first or global-first preference
and converts that preference into explicit model-source and registry orders. Storage and
acquisition never depend on `RegionService` or geography.

One path is then used by model files and runtime tarballs alike:

1. **Mirror fallback** (`withMirrorFallback`) — try each mirror in region order.
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

That move is best-effort on purpose: a live inference worker can hold the files open, and
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
removal and after an interrupted download alike. Complete bundle files are the durable
liveness signal; an active attempt holds transient reservations in
`LocalModelStorageService`. Removal registers itself before touching disk, so a new attempt
either makes GC skip the artifact or waits for an already-started removal before installing.

## Runtime

Inference runs in an Electron `UtilityProcess`, **one per capability**. Sharing a single
process would mean that cancelling an OCR download — which must release the file handles on
its weights — also evicts the 600MB embedding pipeline an unrelated knowledge-base index is
mid-way through. Separate processes isolate native runtimes, pending requests and termination.

Each host is a lifecycle service (`EmbeddingInferenceService`, `OcrInferenceService`,
`AsrInferenceService`) over `InferenceServiceBase`. The host serializes calls and selects the
runtime profile; `UtilityProcessManager` owns spawning, cancellation, idle release and teardown:

- **Lazy spawn** on the first request, and respawn when the acceleration profile changes —
  a process's execution provider is fixed at session creation.
- **One request at a time** through a `concurrency: 1` queue. A single native inference
  session gains nothing from concurrent calls, and this lets several callers reach the same
  instance with no other coordination.
- **Terminate cancellation** for inference, so aborting a native call cannot leave it running.
- **Idle release** after 60s and process teardown during application shutdown.

### Protocol

`inferenceProcess.ts` declares one typed utility-process contract per capability. Connect-time
init data carries the app root, artifact-path map and runtime profile; request and result
payloads live beside their facade under `capabilities/<name>/protocol.ts`. The core utility-
process layer owns request ids, structured cloning, cancellation, errors and child logging.

Results are typed **per request method** rather than merged into one struct of optional fields,
so each client and child handler share the exact input, output and event contract.

### Utility-process entries

Each capability has a packaged entry under `runtime/utilityEntries/`, built separately from
the main process. The entry calls `serveUtilityProcess` with its typed handlers and shares only
child-safe package loading, model caching, cleanup and hardware fallback from
`inferenceRuntime.ts`.

Adding a capability is therefore a new contract, handler and utility-process entry, not
another branch in a shared request dispatcher. Models load by absolute path; downloading and
proxy policy remain in the main process.

### Hardware fallback

A process started on DirectML/CoreML that fails mid-request disposes its cached sessions,
drops to CPU **for the rest of its life**, and retries once. Staying on CPU matters: a
provider that failed once will fail again on the next cache miss, and re-discovering that
per request would pay the fallback cost every time. If CPU fails too, the error names both
failures, since "CoreML crashed" and "the model is corrupt" need different fixes.

This fallback applies to embedding and OCR. FunASR is CPU-only and does not consult the
hardware-acceleration preference.

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
3. If it needs a native runtime that is not already a `SharedArtifact`, add one and list
   every platform it ships binaries for — omissions are what make a platform unsupported.
4. Add its id — and, for a new capability, that capability and its bundle mapping — to
   `src/shared/data/presets/localModel.ts`.
5. Add its removal hooks in `capabilities/capabilityHooks.ts`.
6. For a new capability, add its card icon in `LocalModelsSection` and its `name`/`subtitle`
   i18n keys.
7. For a new capability, add a directory under `capabilities/` containing its request/result
   maps and facade service, plus a typed utility-process entry and handlers.

The catalog's own test suite enforces the mechanical parts (checksum present and
well-formed, keys and paths unique, `requires` resolvable), so a missed field fails in CI
rather than on a user's machine.

## Known limits

- No remote catalog. Adding a model means shipping a release; nothing fetches the model
  list at runtime.
- No streaming download resume. A failed download restarts that file from zero.
- No streaming inference. Every request is one round trip with a complete result; a
  transcription capability that wants partial output would add a response frame type.
