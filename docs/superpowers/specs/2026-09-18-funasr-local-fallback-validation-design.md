# FunASR Local Fallback Validation Design

## Goal

Validate the pre-macOS-26 branch of the local speech design by adding FunASR Nano as Cherry Studio's third local-model capability, downloading it only after an explicit user action, and running transcription without network access.

This phase proves the backend fallback needed by issue 19797. It does not yet add Composer recording controls, playback UI, voice preferences, or the shared `VoiceSessionService`.

## Options considered

### Extend the existing local-model subsystem

Add an `asr` capability beside embedding and OCR, reuse its verified download catalog, and run sherpa-onnx in a dedicated Electron UtilityProcess.

This is the recommended option because current `main` already owns model status, explicit downloads, checksums, cancellation, removal, native-runtime acquisition, process isolation, and idle cleanup. PR 19981 used the same domain boundary, although its commits were based on an earlier revision of the UtilityProcess stack.

### Bundle sherpa-onnx directly with the application

This avoids extending shared-artifact acquisition, but adds a large native runtime to installers for users who never enable local ASR. It also makes cross-platform packaging depend on which optional native package was installed on the build host.

### Add a second downloader inside `@cherrystudio/system-speech`

This keeps speech code together, but duplicates checksum verification, mirror fallback, progress, cancellation, cleanup, paths, and model state. It would create two local-model ownership systems and a second Settings integration.

## Scope

The implementation will:

1. Add the FunASR Nano int8 model and sherpa-onnx runtime to the existing local-model catalog.
2. Keep model and native-runtime acquisition behind the existing explicit Settings download action.
3. Add a CPU-only ASR UtilityProcess that accepts a local WAV path or in-memory samples.
4. Segment speech with Silero VAD, resample to 16 kHz, and split decoder input into at most 25-second chunks.
5. Return final text and timestamped segments without logging transcript content.
6. Add the model card to Settings with inherited download, cancel, retry, remove, and unsupported behavior.
7. Validate transcription once normally and once with network access denied.

The implementation will not automatically download the model, upload audio, fall back to a Provider, add a universal codec layer, expose FunASR directly to renderer code, or claim actual macOS 25 compatibility without a macOS 25 host.

## Shared-artifact contract

The existing catalog assumes one npm package and tarball checksum for every platform. `onnxruntime-node` has that layout; sherpa-onnx publishes a different package and tarball per platform.

The shared contract moves `packageName` and `tarballSha256` from `SharedArtifact` to `ArtifactPlatformFiles`. Existing onnxruntime entries repeat the same values per platform. Acquisition keeps the same verified tarball installer, cancellation, atomic extraction, and removal behavior.

Bundling sherpa-onnx would increase installer size and bypass on-demand runtime acquisition. A speech-only downloader would duplicate shared acquisition correctness and cleanup. The contract change fixes the catalog's general inability to describe platform-split native npm artifacts and can represent any native runtime with this publishing layout.

## Model and runtime

The `funasr-nano-int8` bundle is installed under the centralized `feature.asr.funasr` path. It contains the encoder adaptor, int8 LLM, int8 embedding weights, Qwen tokenizer files, and Silero VAD.

The bundle requires the `sherpa-onnx` shared artifact. The JavaScript wrapper is an application dependency; a narrow pnpm patch loads the explicitly installed native binding from `CHERRY_SHERPA_ONNX_BINDING_PATH`.

The UtilityProcess receives only absolute installed paths and PCM samples or a WAV path. It has no download API, proxy configuration, credentials, or Provider access.

## ASR execution

`AsrInferenceService` follows the existing embedding and OCR service pattern: `WhenReady` lifecycle registration, one dedicated `inference.asr` process, serialized native inference, a CPU-only runtime profile, 60-second idle release, and termination before model removal.

The handler reads WAV locally or accepts samples, resamples to 16 kHz, runs Silero VAD, divides speech into decoder chunks no longer than 25 seconds, decodes each chunk, and returns joined final text with timestamps.

## Lifecycle analysis

### Verdict + confidence + rationale

`Lifecycle required`, high confidence. The capability registers a persistent UtilityProcess definition and exposes a runtime whose process can survive individual requests, idle, terminate, and block model removal. The existing lifecycle base and `UtilityProcessManager` already own these transitions for embedding and OCR.

### Evidence

- `InferenceServiceBase.ts` registers definitions during `onInit`, serializes calls, and terminates capability processes.
- `UtilityProcessManager.ts` owns process hosts, idle release, cancellation, stop, and restart.
- `EmbeddingInferenceService.ts` and `OcrInferenceService.ts` are the established comparable services.
- `capabilityHooks.ts` resolves the lifecycle owner before deleting open model files.

### Over-design assessment

No new lifecycle abstraction is justified. Adding ASR to the existing base is required because model removal must stop the process holding native files. A separate speech process manager would duplicate ownership.

### Alternatives considered

An ordinary function cannot own process registration or stop the process before removal. A direct-import singleton would duplicate lifecycle behavior. `UtilityProcessManager` remains the resource owner but intentionally has no FunASR model semantics. A small `AsrInferenceService` subclass matches the existing lifecycle shape.

### Recommended lifecycle design / Not applicable

Register `AsrInferenceService` in `WhenReady`, inherit the existing same-phase dependency through `InferenceServiceBase`, keep model resolution request-scoped, and use the existing termination barrier during removal. Do not add activation, pause, durable recovery, timers, or a new shutdown policy.

### Implementation outline (do not edit or execute)

Extend the catalog and native-artifact descriptor, add the ASR process contract, entry, handler, and service, register it beside embedding and OCR, expose the Settings model card, and verify focused catalog, acquisition, inference, and UI tests before runtime validation.

### Open evidence

An actual packaged run on macOS 25 or earlier remains unavailable on the current macOS 26.3 host. This implementation can prove the FunASR runtime locally and the routing policy in tests, but cannot claim legacy-OS certification.

## Error and privacy behavior

- Missing model/runtime files fail before process launch.
- Cancellation terminates the capability process using the current UtilityProcess policy.
- Empty or silent input returns an empty transcript.
- File errors do not retry another model.
- No error triggers a Provider request or model download.
- Logs contain identifiers and request kind only, never transcript text or audio samples.

## Verification

The phase is complete when catalog and acquisition tests cover platform-specific runtime packages; Settings exposes only an explicit download; inference tests cover segmentation, timestamps, chunking, resampling, WAV input, silence, and installed paths; the real model transcribes a local WAV normally and with network access denied; route tests still select Apple on macOS 26+ and FunASR below 26; and focused tests, `pnpm lint`, and `pnpm build:check` pass.
