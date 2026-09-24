# Local voice production IPC smoke

This manual harness connects to an **already running, tracked** Cherry Studio main window. It does not launch Electron, download assets, access the microphone, or select another window automatically. Use an isolated test profile with Apple speech assets and an installed voice for the chosen test language on macOS 26 or later.

Pass the local CDP endpoint and the main window's complete URL explicitly; there must be exactly one matching page. Navigation between target discovery and execution also fails the check.

```bash
pnpm exec tsx scripts/voice-runtime-smoke/run.ts \
  --cdp-endpoint http://127.0.0.1:9222 \
  --expected-url 'http://localhost:5173/windows/main/index.html'
```

The default language is `en-US`. Add `--language zh-CN` to use already installed Chinese assets and a matching voice. These are the only two accepted languages; each uses a fixed synthetic phrase, and neither option installs resources.

Use the URL from the tracked instance, not the example value. A packaged main window may use a `file:` URL. The harness emits one metadata-only JSON object on stdout and exits nonzero on failure. Redirect stdout to preserve evidence. Errors contain fixed codes and stages, never transcript text, audio bytes, physical file paths, or native error details.

The renderer function uses the real preload `window.api.ipcApi.request` routes to:

1. List installed voices and select an exact voice ID matching the chosen language; inspect Apple ASR readiness without installing anything.
2. Generate a synthetic phrase with Apple TTS and read its FileEntry using binary `file.read`.
3. Decode that WAV with `AudioContext`, route it to `MediaStreamDestination`, and produce actual WebM/Opus with `MediaRecorder`. The source is not connected to speakers.
4. Upload the recording to a fresh session and explicitly run Apple ASR; require a nonempty transcript without exporting its contents.
5. Upload the same WebM to another fresh session, explicitly choose FunASR Nano, and require `VOICE_LICENSE_UNVERIFIED`. Success or another error fails the check.
6. Stop audio resources and discard every allocated session, including on failure. A cleanup failure also fails the check.

The output proves only the routes exercised in that particular run. It does not prove recognition accuracy, platform coverage, code signing, packaged ASAR/resource placement, offline operation, or model redistribution rights. Offline evidence requires the caller's external network restriction; the harness does not change host networking.

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

These tests check target selection, sensitive-output suppression, cleanup, empty transcription, and incorrect FunASR fallback. Their browser/IPC doubles validate the harness contract; only a real application run is voice-runtime evidence. This differs from the separate [utility-process smoke](../utility-process-smoke/README.md), which boots a throwaway engine test app.
