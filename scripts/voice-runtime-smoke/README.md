# Local voice production IPC smoke

This manual harness connects to an **already running, tracked** Cherry Studio main window. It does not launch Electron, download assets, access the microphone, or select another window automatically. Use an isolated test profile with Apple speech assets, an installed voice for the chosen test language, and the FunASR Nano local model already installed and ready on macOS 26 or later.

Pass the local CDP endpoint and the main window's complete URL explicitly; there must be exactly one matching page. Navigation between target discovery and execution also fails the check.

```bash
pnpm exec tsx scripts/voice-runtime-smoke/run.ts \
  --cdp-endpoint http://127.0.0.1:9222 \
  --expected-url 'http://localhost:5173/windows/main/index.html'
```

The default language is `en-US`. Add `--language zh-CN` to use already installed Chinese assets and a matching voice. These are the only two accepted languages; each uses a fixed synthetic phrase, and neither option installs resources.

Use the URL from the tracked instance, not the example value. A packaged main window may use a `file:` URL. The harness emits one metadata-only JSON object on stdout and exits nonzero on failure. Redirect stdout to preserve evidence. Errors contain fixed codes and stages, never transcript text, audio bytes, physical file paths, or native error details.

The renderer function uses the real preload `window.api.ipcApi.request` routes to:

1. List installed voices and select an exact voice ID matching the chosen language; inspect Apple ASR and FunASR readiness without installing anything.
2. Generate a synthetic phrase with Apple TTS and fetch its session-owned `cherry-media://audio/…` URL.
3. Decode that WAV with `AudioContext` and discard the speech session before admitting any recording. Route the decoded audio to `MediaStreamDestination` and produce actual WebM/Opus with `MediaRecorder`. The source is not connected to speakers.
4. Admit a fresh session through `ai.voice.recording.start`, upload the recording, and explicitly run Apple ASR; require a nonempty transcript without exporting its contents, then discard the session.
5. Admit another recording session before uploading the same WebM, explicitly choose FunASR Nano without a language hint, and require a nonempty transcript with at least one timed segment. Only `transcriptNonEmpty`, segment count, and duration metadata enter the evidence.
6. Stop audio resources and discard every allocated session, including on failure. A cleanup failure also fails the check.

The output proves only the routes exercised in that particular run. It does not prove recognition accuracy, platform coverage, code signing, packaged ASAR/resource placement, offline operation, or model redistribution rights. Offline evidence requires the caller's external network restriction; the harness does not change host networking.

## Windows x64 TTS

Use `--mode windows-tts` with an already running, tracked Windows x64 application and an installed SAPI voice matching `--language` (`en-US` or `zh-CN`):

```sh
pnpm exec tsx scripts/voice-runtime-smoke/run.ts --cdp-endpoint http://127.0.0.1:9222 --expected-url 'http://localhost:5173/windows/main/index.html' --mode windows-tts --language en-US
```

This mode selects an exact installed voice, checks Windows TTS readiness, explicitly requests the Windows model through production IPC, reads and decodes the returned WAV, and discards its session. It does not call ASR, MediaRecorder, or microphone permissions, install resources, change preferences, or fall back to Apple. Output contains only model/voice identifiers and audio metadata. It verifies synthesis and the application media/session path; it does not play through speakers or verify playback controls. Run it against the installed and portable applications as well as development builds, using each tracked window's actual URL. Network isolation and Windows code-signature checks remain separate requirements.

## Reuse inside an offline packaged harness

`renderer.js` contains the self-contained renderer function. The Node-side loader produces the exact expression used by CDP, so a packaged smoke controller can evaluate it through the tracked main window:

```typescript
import { createVoiceRuntimeSmokeExpression } from './rendererExpression'

const result = await mainWindow.webContents.executeJavaScript(
  createVoiceRuntimeSmokeExpression(mainWindow.webContents.getURL(), 'zh-CN'),
  true
)
```

The caller remains responsible for selecting and verifying the expected main window, enforcing network restrictions, and saving only the returned metadata. Pass `true` to preserve the user gesture needed by Web Audio.

## Focused harness tests

```bash
pnpm exec vitest run --project scripts scripts/voice-runtime-smoke/__tests__/smoke.test.ts
```

These tests check target selection, installed-model readiness, recording admission and session ownership, explicit model selection without fallback, sensitive-output suppression, cleanup, and empty transcription from either engine. Their browser/IPC doubles reject uploads without an active recording lease and reject access after another session takes ownership; only a real application run is voice-runtime evidence. This differs from the separate [utility-process smoke](../utility-process-smoke/README.md), which boots a throwaway engine test app.

## Sherpa Windows ARM64 runtime

The [runtime workflow](../../.github/workflows/sherpa-win-arm64.yml) builds the Node-API addon on a native `windows-11-arm` runner. It checks out the upstream source revision in [the runtime configuration](./sherpa-arm64-runtime.json), verifies the official shared MT SDK checksum, and applies [the Windows CMake patch](./sherpa-node-addon-win32.patch). The JavaScript package version must match the pinned native SDK version. No inference-engine source is maintained in this repository.

The workflow runs for changes to its build inputs and can also be dispatched manually. It downloads the checksum-verified Kokoro and FunASR bundles from the application catalog. The same addon must synthesize a non-silent Chinese-English WAV and recognize nonempty text in both native Node and the application's Electron version through a utility process. These checks prove native loading and inference, not recognition quality, installed application packaging, or UI support.

Each run uploads the native binaries, dependency inspection, synthetic WAVs, result reports, runtime archive, and SHA256 file as the `sherpa-win-arm64-runtime` artifact. The archive contains only the addon, SDK DLLs, license, and build provenance; smoke models and audio are excluded. The checks reject non-ARM64 binaries and dynamic MSVC runtime dependencies.

To publish a durable download, dispatch the workflow on `main` in `CherryHQ/cherry-studio` with `publish` enabled. Publication runs only after both inference checks pass, creates a new `sherpa-runtime-v<version>-r<runtimeRevision>` tag, and uploads the archive and checksum as a prerelease without changing the latest application release. Existing tags are rejected; increment `runtimeRevision` for a new build. After a failed publication, inspect any tag or partial release before retrying. Client download URLs and platform availability are configured separately after publication and packaged application validation.

When upgrading Sherpa, update the source revision, SDK checksum, and tool versions in the runtime configuration together with the application's JavaScript dependency and its loader patch. Recheck whether the upstream CMake file still needs the Windows patch. An official compatible Windows ARM64 addon can replace this build when available.
