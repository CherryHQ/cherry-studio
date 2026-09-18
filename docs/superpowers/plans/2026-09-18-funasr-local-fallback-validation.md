# FunASR Local Fallback Validation Implementation Plan

> **For AI agent workers:** Required sub-skill: use `superpowers:executing-plans` to implement each task inline. Steps use checkboxes to track progress.

**Goal:** Add FunASR Nano as an explicitly downloaded local ASR capability and prove real local transcription with outbound networking denied.

**Architecture:** Extend the existing local-model catalog and UtilityProcess runtime used by embedding and OCR. Keep the Apple adapter in `@cherrystudio/system-speech`; FunASR remains a main-process local-model capability selected by the future Voice orchestration layer.

**Tech stack:** TypeScript, Electron UtilityProcess, sherpa-onnx-node 1.13.6, FunASR Nano int8, Silero VAD, Vitest, React/i18next.

---

## File structure

- `src/main/ai/localModel/catalog/{types,catalog}.ts`: describe platform-split native artifacts and the FunASR bundle.
- `src/main/ai/localModel/acquisition/{tarballArtifact,modelSource}.ts`: download the correct platform runtime and add the byte-identical HuggingFace mirror.
- `src/main/ai/localModel/capabilities/asr/`: resolve installed model paths and expose the lifecycle inference service.
- `src/main/ai/localModel/runtime/utilityEntries/inferenceAsr*.ts`: run sherpa recognition in the isolated utility process.
- `src/main/ai/localModel/runtime/{inferenceProcess,utilityEntries/inferenceRuntime}.ts`: register the typed ASR process and lazy native loader.
- `src/shared/data/presets/localModel.ts`: expose `asr` and `funasr-nano-int8` across processes.
- `src/renderer/pages/settings/DependenciesSettings/LocalModelsSection.tsx`: reuse the explicit local-model download UI.
- `scripts/funasr-validation/`: real Electron UtilityProcess smoke harness for normal and network-denied inference.
- `packages/system-speech/src/routePolicy.ts`: retain Apple 26+ / FunASR pre-26 routing tests.

### Task 1: Support platform-specific native runtime tarballs

**Files:**
- Modify: `src/main/ai/localModel/catalog/types.ts`
- Modify: `src/main/ai/localModel/catalog/catalog.ts`
- Modify: `src/main/ai/localModel/acquisition/tarballArtifact.ts`
- Test: `src/main/ai/localModel/acquisition/__tests__/tarballArtifact.test.ts`
- Test: `src/main/ai/localModel/catalog/__tests__/catalog.test.ts`

- [x] **Step 1: Add failing acquisition tests**

Add a fixture whose `darwin-arm64` platform entry supplies `packageName` and `tarballSha256`, then assert the requested npm URL and checksum come from that platform entry. Keep the existing onnxruntime behavior assertion.

- [x] **Step 2: Run the focused tests and confirm failure**

Run: `pnpm test:main src/main/ai/localModel/acquisition/__tests__/tarballArtifact.test.ts src/main/ai/localModel/catalog/__tests__/catalog.test.ts`

Expected: type/test failure because platform entries do not yet own package metadata.

- [x] **Step 3: Move package metadata to `ArtifactPlatformFiles`**

Change the contract to:

```ts
export interface SharedArtifact {
  id: SharedArtifactId
  version: string
  installDirKey: PathKey
  platforms: Partial<Record<PlatformKey, ArtifactPlatformFiles>>
}

export interface ArtifactPlatformFiles {
  packageName: string
  tarballSha256: string
  tarballPrefix: string
  installSubdir: string
  entryFile: string
  supportFiles: string[]
}
```

Update `tarballArtifact.ts` to build the registry URL and verify the digest from the selected platform entry. Repeat the current onnxruntime package name and digest in each supported platform entry without changing paths or versions.

- [x] **Step 4: Run focused tests and commit**

Expected: both focused test files pass.

Commit: `git commit -S --signoff -m 'refactor(local-model): support platform native artifacts'`

### Task 2: Add the explicitly downloaded FunASR bundle

**Files:**
- Modify: `src/shared/data/presets/localModel.ts`
- Modify: `src/main/ai/localModel/catalog/catalog.ts`
- Modify: `src/main/ai/localModel/acquisition/modelSource.ts`
- Modify: `src/main/core/paths/pathRegistry.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Add: `patches/sherpa-onnx-node@1.13.6.patch`
- Test: `src/main/ai/localModel/catalog/__tests__/catalog.test.ts`
- Test: `src/main/ai/localModel/acquisition/__tests__/modelSource.test.ts`
- Test: `src/main/core/paths/__tests__/pathRegistry.test.ts`

- [x] **Step 1: Add failing catalog and mirror tests**

Assert that `asr` maps to `funasr-nano-int8`, the bundle requires `sherpa-onnx`, every declared model file has a digest, and `hf-mirror` resolves the same path shape as HuggingFace. Assert the two new centralized path keys exist.

- [x] **Step 2: Run the focused tests and confirm failure**

Run: `pnpm test:main src/main/ai/localModel/catalog/__tests__/catalog.test.ts src/main/ai/localModel/acquisition/__tests__/modelSource.test.ts src/main/core/paths/__tests__/pathRegistry.test.ts`

Expected: failures for the missing capability, bundle, mirror, artifact, and paths.

- [x] **Step 3: Port the verified PR 19981 catalog data**

Add the model files and exact SHA-256 values from PR 19981, add `sherpa-onnx` platform packages, add `hf-mirror` between the regional default and final fallback, and add `feature.sherpa_onnx.binary` plus `feature.asr.funasr` through `pathRegistry.ts`.

Pin `sherpa-onnx-node` at `1.13.6`; patch only its binding lookup to prefer `CHERRY_SHERPA_ONNX_BINDING_PATH`. Run `pnpm install` so the lockfile records the dependency and patch.

- [x] **Step 4: Run focused tests and commit**

Expected: catalog, mirror, and path tests pass.

Commit: `git commit -S --signoff -m 'feat(local-model): add explicit FunASR download'`

### Task 3: Add the FunASR inference UtilityProcess

**Files:**
- Add: `src/main/ai/localModel/capabilities/asr/AsrInferenceService.ts`
- Add: `src/main/ai/localModel/capabilities/asr/modelPaths.ts`
- Add: `src/main/ai/localModel/capabilities/asr/protocol.ts`
- Add: `src/main/ai/localModel/runtime/utilityEntries/inferenceAsr.ts`
- Add: `src/main/ai/localModel/runtime/utilityEntries/inferenceAsrHandlers.ts`
- Add: `src/main/ai/localModel/capabilities/asr/__tests__/AsrInferenceService.test.ts`
- Modify: `src/main/ai/localModel/runtime/inferenceProcess.ts`
- Modify: `src/main/ai/localModel/runtime/utilityEntries/inferenceRuntime.ts`
- Modify: `src/main/ai/localModel/runtime/__tests__/inferenceEntryHarness.ts`
- Modify: `src/main/ai/localModel/capabilities/capabilityHooks.ts`
- Modify: `src/main/ai/localModel/index.ts`
- Modify: `src/main/core/application/serviceRegistry.ts`
- Modify: `electron.vite.entries.config.ts`

- [x] **Step 1: Port the handler contract tests before implementation**

Use the PR 19981 sherpa fake and assert speech segmentation, timestamps, 25-second chunks, 8 kHz to 16 kHz resampling, local WAV reads, missing-file failure, silent input, empty model output, and exact installed model paths.

- [x] **Step 2: Run the ASR test and confirm failure**

Run: `pnpm test:main src/main/ai/localModel/capabilities/asr/__tests__/AsrInferenceService.test.ts`

Expected: module/type failure because the ASR service and entry do not exist.

- [x] **Step 3: Implement the smallest ASR process**

Use `OfflineRecognizer`, `Vad`, `LinearResampler`, and `readWave` from the lazy `getSherpa()` loader. Set `COPY_SAMPLES = false` so native buffers are copied into Electron's V8 sandbox. Keep the current `cancellation: 'terminate'` policy instead of porting unrelated PR drift.

Register `inference-asr`, `AsrInferenceService`, its removal hook, and its service export. Force CPU init data for ASR; do not alter embedding/OCR acceleration behavior.

- [x] **Step 4: Run focused ASR and existing inference tests**

Run: `pnpm test:main src/main/ai/localModel/capabilities/asr/__tests__/AsrInferenceService.test.ts src/main/ai/localModel/runtime/__tests__/inferenceProcess.test.ts src/main/ai/localModel/runtime/__tests__/InferenceServiceBase.test.ts`

Expected: all focused tests pass.

- [x] **Step 5: Build the utility entries and commit**

Run: `pnpm build:utility-process`

Expected: `out/utility-process/inference-asr.js` is emitted without a non-hermetic dependency.

Commit: `git commit -S --signoff -m 'feat(local-model): transcribe with FunASR Nano'`

### Task 4: Expose the explicit Settings download

**Files:**
- Modify: `src/renderer/pages/settings/DependenciesSettings/LocalModelsSection.tsx`
- Modify: `src/renderer/pages/settings/FileProcessingSettings/components/LocalModelRequirement.tsx`
- Modify: `src/renderer/i18n/locales/en-us.json`
- Modify: `src/renderer/i18n/locales/{de-de,el-gr,en-us,es-es,fr-fr,ja-jp,pt-pt,ro-ro,ru-ru,tr-tr,vi-vn,zh-cn,zh-tw}.json`
- Test: `src/renderer/pages/settings/DependenciesSettings/__tests__/LocalModelsSection.test.tsx`

- [x] **Step 1: Add a failing interaction assertion**

Assert the ASR card is visible in `not_downloaded` state and no download request occurs until its Download button is clicked. Assert unsupported state hides that button.

- [x] **Step 2: Run the focused renderer test and confirm failure**

Run: `pnpm test:renderer src/renderer/pages/settings/DependenciesSettings/__tests__/LocalModelsSection.test.tsx`

Expected: the ASR card or unsupported behavior is absent.

- [x] **Step 3: Add the ASR card and translations**

Add the `AudioLines` card using `settings.dependencies.localModels.asr.name` and `.subtitle`. Reuse the existing hook and button; do not add automatic effects. Add the unsupported notice per card. Run `pnpm i18n:sync`, then replace every generated placeholder using the translations from PR 19981.

- [x] **Step 4: Run the renderer test and i18n check, then commit**

Run: focused renderer test and `pnpm i18n:check`.

Fold these files into the explicit-download commit above so the exhaustive capability records typecheck in every
commit.

### Task 5: Validate the real runtime locally and offline

**Files:**
- Add: `scripts/funasr-validation/run.ts`
- Add: `scripts/funasr-validation/main.ts`
- Add: `scripts/funasr-validation/electron.vite.config.ts`
- Modify: `package.json`
- Modify: `docs/references/ai/local-models.md`

- [ ] **Step 1: Add a validation runner that reports metadata only**

The runner accepts an input WAV and uses the installed catalog paths. It builds the real `inference-asr` entry, starts Electron, calls the typed UtilityProcess once, and outputs locale-independent metadata: non-empty transcript, segment count, and duration bounds. It never prints transcript content.

- [ ] **Step 2: Use the existing Settings card to download explicitly**

Open the tracked Cherry Studio instance, navigate to Dependencies, click Download on the FunASR card, wait for `ready`, and capture UI/log evidence. This click is the only operation allowed to start model or runtime acquisition.

- [ ] **Step 3: Run normal real-model validation**

Use the Apple TTS WAV already generated by the system-speech validation as input. Run `pnpm validate:funasr -- --input <wav>`. Expected: `transcriptNonEmpty: true` and at least one segment.

- [ ] **Step 4: Run network-denied validation**

Run the same harness through `sandbox-exec` with `(deny network*)` and Electron's inner sandbox disabled only for this outer-sandbox validation. Expected: the same local inference metadata and `networkDenied: true`.

- [ ] **Step 5: Document evidence and commit**

Record host, model/runtime state, WAV format, normal result, offline result, and the remaining lack of an actual pre-macOS-26 host.

Commit: `git commit -S --signoff -m 'test(local-model): validate FunASR offline'`

### Task 6: Completion verification

- [ ] Run all focused system-speech and local-model tests.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build:check`.
- [ ] Run `pnpm test:lint`.
- [ ] Inspect `git diff main...HEAD` for unrelated changes.
- [ ] Verify every new commit has a `gpgsig` header and DCO signoff.
- [ ] Update this plan's checkboxes and commit the final verification record if documentation changed.
