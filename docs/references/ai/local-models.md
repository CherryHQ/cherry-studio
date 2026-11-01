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

Cherry Studio can run four model capabilities on the user's own machine: knowledge-base
embedding, PaddleOCR text recognition, speech recognition with FunASR Nano or Qwen3-ASR, and speech synthesis with Qwen3-TTS or Kokoro. Their model
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
    ├── asr/                       ← facade, discriminated engine requests, selected model paths
    └── tts/                       ← facade, complete WAV and bounded PCM contracts
```

## The catalog is the only per-model code

Installation metadata belongs in `catalog/catalog.ts`. Downloads and removal are generic over
that catalog. Inference dispatches on the selected bundle’s engine architecture; a new engine
adds its own typed handler without duplicating installation machinery.

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
| `urls` / `sizeBytes` | Direct distribution URLs: a fixed-order list or `{ china, global }` pair ordered by egress region |
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

- A **capability** classifies models (`embedding`, `ocr`, `asr`, `tts`). It does not identify an installation.
- A **bundle id** identifies the exact model files/format/quantization a user installs.
  Status, download, cancellation, removal and inference preserve this identity.

`DEFAULT_LOCAL_MODEL_BUNDLE_BY_CAPABILITY` holds recommendations for consumers without a model
selector. `isDefaultModelReady(capability)` is only for those consumers; selected models use
`isModelReady(bundleId)` or `refreshStatus(bundleId)`. Installing A must never make B ready.
The catalog allows multiple bundles with the same capability. Engine process initialization
names its runtime artifacts directly; it does not resolve them through a default model.

### Shared artifacts

A **shared artifact** is a pinned native runtime. Embedding and OCR use
`onnxruntime-node`; FunASR and Kokoro use `sherpa-onnx`; Qwen3-ASR and Qwen3-TTS share a Cherry-distributed mlx-node archive. Bundles declare what they need in `requires`, and
that declaration is what makes the runtime removable: it outlives a bundle exactly as long
as another *installed* bundle still requires it.

`platforms` is a support matrix, not just a path table. A missing entry means the artifact
ships nothing there, so every bundle requiring it reads as `unsupported` rather than
offering a download that could only fail. Each entry pins its npm package and tarball digest
and lists the files extracted for that target. `onnxruntime-node` selects a platform subtree
from one package and has no Intel Mac build; sherpa-onnx uses one npm package per platform,
except Windows ARM64, which downloads a checksum-pinned runtime from the independent
`CherryHQ/sherpa-onnx` releases. Its tag, archive name, and checksum live in
`catalog/sherpaRuntimeRelease.json`.

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

FunASR Nano installs the compatibility decoder as `llm.int8.compat.onnx`. An older
`llm.int8.onnx` does not satisfy readiness: the existing incomplete-install retry downloads
only the new decoder and reuses the other bundle files. The old decoder remains unused
until the bundle is removed. The compatibility decoder uses a pinned ModelScope source;
the older Hugging Face decoder is not a fallback for it.

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

`removeModelThen(bundleId, after)` blocks new and queued requests for that model. It stops
and awaits the worker only when that model is resident, before deleting open weight files.
Removing an unused model does not terminate another model's active inference. Each adapter
must release the previous model before loading a different model; residency remains bounded.

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
`AsrInferenceService`, `TtsInferenceService`) over `InferenceServiceBase`. The host serializes calls and selects the
runtime profile; `UtilityProcessManager` owns spawning, cancellation, idle release and teardown:

- **Lazy spawn** on the first request, and respawn when the acceleration profile changes —
  a process's execution provider is fixed at session creation.
- **One request at a time** through a `concurrency: 1` queue. A single native inference
  session gains nothing from concurrent calls, and this lets several callers reach the same
  instance with no other coordination. A streamed execution retains its slot until `closed`,
  including cancellation cleanup; returning its handle does not release the queue.
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

This fallback applies to embedding and OCR. FunASR and Kokoro are CPU-only and do not consult the
hardware-acceleration preference.

### Kokoro Chinese-English speech

The `kokoro-multi-lang-v1.1` bundle pins the full-precision ONNX weights, all 103 voices,
Chinese normalization rules, both Chinese and English lexicons, and the English eSpeak
data needed for words absent from the lexicons, including Mandarin language and dictionary
data. Every file is checksummed and fetched from an immutable Hugging Face revision, with
hf-mirror as a fallback. The worker sets `ESPEAK_DATA_PATH` to the bundle's eSpeak data
directory before initializing the native runtime. The runtime is shared with FunASR;
removing either model retains it while the other is installed.

Kokoro runs through `inference.tts` on macOS arm64/x64, Linux arm64/x64 and Windows arm64/x64.
Windows ARM64 shares the verified Sherpa runtime with FunASR. The worker loads both
lexicons together and leaves the language override unset so a single request can contain
Chinese and English. Language preferences select a default voice; they do not split mixed
text into separate synthesis requests. The existing host stops the process before changing
model bundles, on cancellation, or before removing resident model files.

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
- ASR, embedding and OCR still return complete results. Qwen3-TTS also supports bounded PCM
  output; continuous ASR input and transcription revisions are separate capabilities.


## Downloadable Qwen3-TTS

The initial package is CustomVoice 0.6B, affine 8-bit/group-size 64, with the dense speech
codec. The mlx-node commit, model revision, archive and every model-file digest are pinned in
`catalog/mlxNodeRelease.json`. The JavaScript API is an application dependency,
`@cherrystudio/mlx-tts`, pinned to a commit in the
[CherryHQ/mlx-node fork](https://github.com/CherryHQ/mlx-node/tree/cherry/tts-package/distribution).
The fork owns package generation; Cherry Studio does not compile MLX or repackage its API.
The package includes the upstream NAPI-RS loader, but no native binaries or model weights.
The utility process resolves it from the application root and sets
`NAPI_RS_NATIVE_LIBRARY_PATH` before loading a model.

Native files and model weights remain separate downloads managed by `LocalModelService`.
The native artifact contains only the `.node` entry, Metal libraries and license files. It is
published in the `CherryHQ/mlx-node` GitHub fork and mirrored in the separate
`CherryHQ/mlx-node` ModelScope repository. Model weights use the existing GitHub release
assets and `CherryHQ/Qwen3-TTS-0.6B-CustomVoice-8bit` on ModelScope.
Both downloads prefer ModelScope for China egress and GitHub elsewhere, falling back to the
other source on network or checksum failure. Cancellation stops fallback. ModelScope URLs
pin commit revisions; SHA-256 pins the same bytes at both sources. The native files are
unchanged from the previous archive, so its installation directory remains reusable.

It currently requires Apple Silicon and macOS 26.2+. Unsupported targets keep existing speech
providers; Sherpa 1.13.6 does not implement Qwen3-TTS.

The MLX utility process loads one model directory at a time and exits after 60 seconds idle.
Cancellation terminates and awaits the process so native work and its allocator cannot outlive
ownership. The adapter offers both complete WAV and `pcm-stream` output. Preview and read-aloud
prefer PCM when the selected model declares it; other adapters retain complete audio.

`TtsInferenceService.stream()` publishes a typed execution handle while keeping its queue slot
through child cleanup. The child sends the authoritative format before interleaved Float32 PCM,
applies speed conversion once, and splits writes into at most 4,096 source frames. MLX uses a
one-second native audio buffer and two queued text segments. Utility-process output is capped at
four messages / 131,072 bytes, with one pending writer and a 65,536-byte message limit.

Qwen3-TTS also declares `TextStream → PcmStream`. Automatic reading submits stable
assistant body text before completion through one speech execution; reasoning is excluded.
Plain sentences can commit early, while incomplete Markdown stays pending until a safe
block boundary or EOF. Complete-text models retain completion-time automatic reading.

`ai.voice.text.write` accepts sequenced text/flush events for the owning session/request;
`ai.voice.text.finish` closes input without cancelling the remaining audio. Main permits
one pending write, at most 2,048 characters per text event and 5,000 cumulative characters.
The renderer additionally bounds pending text to 5,000 characters / 64 events and raw
snapshots to 20,000 characters. Overflow stops automatic reading with a localized notice;
chat generation continues. The utility input has one 32,768-byte frame and one pending
writer. The native engine owns segmentation, with flush marking a stable commit boundary.
Cancellation, scope exit, disabling automatic reading and preemption invalidate the attempt,
close its text input and release voice resources; late snapshots cannot restart it.
Incremental speech has no retry-from-start control because some text may already be audible.

Playback attaches after installing its listener and Worklet. Main limits outstanding renderer
audio to one second of source frames; cumulative acknowledgements represent actual Worklet
consumption, so pausing propagates backpressure to inference. Playback starts after 500 ms of
source audio, or EOF for shorter clips, within the same one-second capacity. The AudioContext uses the source
sample rate and lets the browser resample for the output device. Producer EOF and playback drain
are separate: the session remains owned until the final source frame is consumed and the output
timestamp passes the tail. PCM does not create a full WAV or enter the media cache.

Model loading and unblocked producer reads have 120-second budgets. Attachment has a 15-second
budget, and a stream retains resources for at most 15 minutes, including pauses. The existing
five-minute generated-audio limit still applies to complete WAV requests; PCM is bounded by stream retention. Explicit playback retry closes the previous
execution before generating a new attempt with the frozen voice, language and speed.

Voice identity and synthesis language are separate. `locale` is the voice's default; optional
`languages` enumerates its supported synthesis languages. Without `languages`, a system voice
supports only its locale. Resolution preserves a supported explicit language, and UI language
changes preserve compatible voices. Unsupported combinations remain unavailable.

## Downloadable Qwen3-ASR

`qwen3-asr-1.7b-8bit` provides complete-audio and streaming PCM recognition on Apple Silicon with macOS 26.2+.
It uses the existing MLX native artifact shared with Qwen3-TTS and an application-owned
`@cherrystudio/mlx-asr` JavaScript package. Its official 1.7B checkpoint, conversion revision,
standard safetensors shards and checksums are pinned in `catalog/qwen3AsrRelease.json`.
The audio encoder stays dense; the decoder uses affine 8-bit/group-size 64 quantization.
Model files use pinned GitHub release assets and a pinned ModelScope revision, with the same
SHA-256 at both sources. China egress prefers ModelScope; other regions prefer GitHub.

Voice selection preserves the bundle ID through status, installation, inference and removal.
`inference.asr` dispatches discriminated Sherpa/MLX requests and lazily loads only the selected
engine. MLX receives 16 kHz mono Float32 PCM decoded from the existing bounded WAV/WebM path;
it does not require Sherpa for decoding. Language is detected automatically. Complete recognition returns final text; streaming recognition
returns replaceable full-text revisions. The model has no reliable timestamps, so segments remain empty. Truncated native
results fail instead of returning partial text as complete recognition.

The ASR queue owns one resident model. Switching models, cancelling native work or removing
resident weights waits for process exit. Successful calls may reuse the warm model until idle
release. The pinned native API has no model-dispose method; process exit releases its model
thread and allocations. ASR removal preserves the MLX artifact while installed TTS still
requires it, and does not stop the independent TTS process.

Streaming dictation uses the same ASR queue for the full stream lifetime. Renderer `PcmCapture`
owns the microphone, AudioContext and worklet. Web Audio continuously converts device input to
mono 16 kHz; the application checks the actual context rate. The worklet sends 100 ms batches,
with at most two seconds of unacknowledged audio. Main uses a single pending batch and the
utility transport bounds input to ten frames / 65,536 bytes. A sustained overload fails explicitly.
The model's default two-second decoding interval is independent of the transport batch size.

Normal stop drains accepted worklet samples before input EOF and final recognition. Cancellation
stops capture, discards queued PCM and terminates native work. Revisions are previews; only
execution completion commits text, once, to the captured target. A lost target uses existing
recovery. Streaming failures have no saved recording to retry. Models without the PCM/revisions
capability retain complete-recording recognition. Microphone waveform updates use the capture
analyser and do not wait for recognition. The existing five-minute recording limit still applies.
