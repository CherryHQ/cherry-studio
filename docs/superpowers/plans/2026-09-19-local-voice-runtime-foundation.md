# Local Voice Runtime foundation implementation plan

> **For agent workers:** use superpowers-zh:subagent-driven-development or
> superpowers-zh:executing-plans task by task, preserving the checked evidence.

**Goal:** deliver the production local Voice IPC/session/aiCore/Apple/FileEntry path,
with an explicit fail-closed FunASR licensing gate.

**Architecture:** immutable model facts feed strict IpcApi requests; lifecycle-owned
sessions authorize files and serialize voice work; AiService calls engine-independent
aiCore one-shot operations backed by private local SDK models.

**Stack:** TypeScript, Zod, Vitest, real SQLite test helper, Electron UtilityProcess,
Mediabunny/Opus WASM, Swift Speech/AVFoundation, electron-builder.

## Repository baseline

- Branch: codex/voice-runtime-foundation from origin/main f236b74929.
- Worktree: .worktrees/voice-runtime-foundation.
- Dependency installation: pnpm install passed.
- FileManager.integration + IPC ai baseline: 90 tests passed.
- Local main and validation PRs must remain untouched; never force-push.

## Implementation status

The operation/facts, session/IPC, decoder, Apple adapter, temporary retention and
packaging wiring are implemented. Focused tests have recorded RED/GREEN evidence.
Full repository gates, tracked production Electron inference with an OS
network-denial policy, and packaged-app helper verification passed. The precise
offline policy and signing limits are recorded below. Only macOS 26.3 arm64 has
real execution evidence. No other platform is claimed as tested.

FunASR is deliberately blocked on converted-checkpoint provenance and licensing;
there is no production FunASR catalog, runtime download or inference implementation.
Formal PR2 remains Preferences, Renderer Voice Client, Dictation Controller,
Speech Playback Controller and Settings test UI. Neither validation PR is formal
PR1/PR2 or a merged dependency, and this foundation does not close #19797.

## 1. Operations and immutable model facts

Files: packages/aiCore/src/core voice operation module/public exports and tests;
src/shared/ai/localVoice.ts and tests; src/main/ai/AiService.ts and focused test.

- [x] Write and run failing tests for existing SDK V3 speech/transcription models,
  no implicit global provider, retry count zero, WAV output, and abort propagation.
- [x] Implement the narrow operations and exported standard option/result types.
- [x] Write and run model-resolution tests:

```typescript
expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 26 })).toBe(APPLE_ASR_MODEL_ID)
expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 25 })).toBe(FUNASR_MODEL_ID)
expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 26 }, FUNASR_MODEL_ID)).toBe(FUNASR_MODEL_ID)
```

- [x] Implement immutable capability/modality facts and AiService delegation to
  private local model factories, without credential resolution or HTTP tracing.
- [x] Run the focused aiCore/shared Vitest projects for operation and model-fact tests.

## 2. File retention and session ownership

Files: src/main/services/file/FileManager.ts, internal/entryCleanup.ts,
src/main/data/services/FileEntryService.ts, matching integration tests; src/main/ai/voice/VoiceSessionService.ts.

- [x] Write a real-database regression: age an automatic temporary entry beyond GC
  grace, retain it, run cleanup, read original content, release, run cleanup and
  observe entry/blob deletion. Add idempotent release and stop cleanup cases.
- [x] Implement FileManager runtime retention without a table/migration or policy rewrite.
- [x] Exclude retained IDs before the SQL batch limit and recheck the live reference
  map in the deleting transaction. Cover 101 retained older entries, late retention,
  explicit deletion, stop cleanup and stale/idempotent disposals.
- [x] Remove physical paths and raw errors from reachable creation, atomic-write,
  deletion and GC logs; retain stable IDs/error codes and prove private sentinels
  stay out of diagnostics.
- [x] Write failing session tests using real FileManager and unified application mock:

```typescript
const file = await service.createRecording(ownerA, { sessionId, audio, mimeType: 'audio/webm;codecs=opus' })
await expect(service.transcribe(ownerB, { sessionId, requestId, fileEntryId: file.id, modelId })).rejects.toMatchObject({ reason: 'forbidden_owner' })
```

- [x] Add regressions for a second active operation, idempotent abort, failed-input
  retry retention, successful-input deletion, owner destruction, pending registration,
  stop/destroy, restart, and TTS output discard. Assert observable files/results.
- [x] Implement session admission before first await; capture owner WebContents,
  model, request, operation, state, abort controller, input/output and terminal state.
- [x] Register lifecycle service and required path keys; no AiStreamManager reuse.
- [x] Run focused Main session and FileManager tests.

## 3. Strict IPC and privacy

Files: src/shared/ipc/schemas/voice.ts, errors/voice.ts, schema aggregation;
src/main/ipc/handlers/voice.ts, handler aggregation; focused shared/Main tests.

- [x] Test rejection of path, bytes, base64, arbitrary adapter/provider options,
  unknown owners, wrong MIME, foreign file IDs, and unknown model capability.
- [x] Implement the four required generate/abort routes plus narrow recording
  registration, discard, model/status discovery and explicit Apple installation.
- [x] Serialize only stable IpcError domain codes. Test sensitive error sentinel
  never appears in logs or error payload. Never reuse exposeAiError.
- [x] Run schema and handler tests through real IpcRouter with a controlled service
  boundary. This proves ownership/error contracts, not end-to-end native inference.
- [x] Complete the production IpcApi → real session → AiService → aiCore → native
  adapter → FileEntry integration in the final runtime verification.

## 4. Private WebM decoder

Files: src/main/ai/voice/localAdapters decoder and utilityEntries; a real WebM
fixture and tests; electron.vite.entries.config.ts; exact package dependencies.

- [x] Add pinned maintained library dependencies and retained license notices.
- [x] Write a failing test with actual WebM/Opus, checking mono 16 kHz PCM WAV header,
  nonzero decoded samples, expected duration, malformed/wrong codec rejection.
- [x] Implement demux + Opus decode, channel mixing, pre-skip/end trim and bounded
  resource use. Never use AudioContext or ffmpeg in product callers.
- [x] Register an existing-framework utility definition with terminate cancellation.
- [x] Test cancellation/cleanup and run utility build to enforce child import isolation.

## 5. Apple native package and adapter

Files: packages/system-speech (selectively rebuilt from 3ac951ed5f);
src/main/ai/voice/localAdapters/apple.ts and local model factory;
mac helper build/resource/signing configuration and native tests.

- [x] Port useful native tests first; record red before production implementation.
- [x] Implement local capabilities, exact voices, explicit ASR asset installation,
  WAV ASR/TTS; sanitize native failures and validate result shape/operation.
- [x] Native client waits for child close on success/abort/timeout; bound output and
  kill escalation; test no lease release or scratch cleanup before child termination.
- [x] Implement SDK V3 local factories. Both model readiness and inference recheck
  platform/resources; no download or engine substitution during generation.
- [x] Add architecture-specific helper build, outside-asar resource copy and
  executable-mode/signing configuration; the actual packaged helper smoke passed.
- [x] Confirm native-owner evidence: package TypeScript/subprocess tests (8), Swift
  tests (8), Apple adapter tests (11), TypeScript build/typecheck, and arm64/x64
  helper compilation. Only arm64 helper execution was exercised; packaged helper
  smoke and production IPC also passed as separate acceptance checks.

## 6. FunASR gate

- [x] Expose stable identity/default recommendation and resource failure
  `license_unverified`; verify explicit selection fails without Apple fallback,
  model download, or native startup.
- [x] Record original/mirror revisions, export provenance gaps, required attribution,
  and why runtime Apache-2.0 does not authorize model publication.
- [x] Do not publish a catalog or unreachable pretend ASR adapter. Full FunASR runtime,
  exact missing bytes and production inference remain blocked until provenance clears.

## 7. Production Electron and packaged validation

Files: maintained voice smoke fixture/test following repository Electron workflow;
.context/cherry-electron-dev/voice-runtime-foundation evidence (not committed).

- [x] Read cherry-electron-dev instance reference fully; create/reuse this worktree's
  tracked instance and isolated userData, without touching other Electron processes.
- [x] Call production IpcApi TTS, register real WebM, call ASR, assert metadata and
  transcriptNonEmpty. Verify abort, nonexistent voice, and missing asset errors.
- [x] Repeat inference under sandbox-exec deny network; no text/audio payload logs.
- [x] Build actual Cherry mac app and smoke its bundled helper, recording platform,
  architecture, signature result and exact command. No direct-helper claim as IPC proof.
- [x] Record FunASR real inference as blocked, never passed or silently substituted.

## 8. Verification, commits and reviewable handoff

- [x] Add the public aiCore minor changeset; the private system-speech package is
  not a separately published release.
- [x] Run pnpm changeset status --since=origin/main.
- [x] Self-review full diff for ownership, data boundaries, sensitive logging,
  implicit downloads, unused helpers, local-only dispatch, and cleanup races.
- [x] Run pnpm lint, pnpm test:lint, pnpm docs:check and pnpm build:check; retain output.
- [x] Create focused Conventional Commits with git commit -S --signoff, and inspect
  every commit for gpgsig plus Signed-off-by.
- [x] Prepare English title `feat(voice): add local speech runtime foundation` and
  full repository-template PR body with Related to #19797, validation evidence,
  scope, measured platform, release blocker and limitations.
- [x] Prepare architecture, reuse inventory, full diff scope, real evidence, limitations,
  title and complete body for user review. Do not push or create a PR in this task.

## Recorded focused evidence

Local logs live under `.context/cherry-electron-dev/voice-runtime-foundation/` and are not committed.
The final verification report supersedes these intermediate test runs.

| Scope | Recorded result | Evidence |
|---|---|---|
| aiCore one-shot operations | 7 passed | `aicore-green.log` |
| Local model facts/defaults | 4 passed | `shared-facts-green.log` |
| AiService new and existing contracts | 72 passed | `aiservice-voice-green.log` |
| Voice session lifetime regressions | 13 passed | `session-lifecycle-green.log` |
| Strict Voice input schemas | 2 passed | `ipc-green.log` |
| Router/handler and service boundary checks | 8 passed | `handler-green.log` |
| Real WebM decoding and worker cancellation | 16 passed | `decoder-green.log` |
| Utility child bundle | built | `decoder-utility-build.log` |
| FileManager, file DB, cleanup and fs primitives | 263 passed, 2 existing skips | `file-retention-privacy-green.log` |
| FileManager docs checks | links, structure, frontmatter, index passed | `file-retention-doc-*.log` |
| Native subprocess protocol | 8 passed | Native implementation owner's tool output |
| Swift command/WAV contracts | 8 passed | Native implementation owner's tool output |
| Main Apple adapter boundary | 11 passed | Native implementation owner's tool output |
| Native helper builds | arm64 and x64 compiled | Native implementation owner's tool output |
| Standalone native smoke | arm64 capabilities and complete TTS WAV succeeded | Native implementation owner's tool output; not IPC or packaged proof |

These are separate overlapping runs, not a combined test total. Session tests use
real FileManager/SQLite with controlled AI execution; router tests control the
service boundary; adapter tests control the helper. The actual decoder fixture is
synthetic tone WebM produced with Chrome MediaRecorder, not speech-ASR evidence.


## Final acceptance evidence

All commands below completed successfully. Full-suite totals are **32,409 passed,
68 skipped** across **2,422 passed test files and 2 skipped files**; focused runs
above overlap this total. The completed suite includes 14 session-lifetime tests
and 9 production-smoke-harness contract tests.

| Command or scenario | Final result | Local evidence |
|---|---|---|
| `pnpm lint` | Passed; type checks, i18n and formatting included | `lint-final.log` |
| `pnpm test:lint` | Passed; 40 existing non-blocking ESLint warnings | `test-lint.log` |
| `pnpm docs:check` | Passed | `docs-check.log` |
| `pnpm build:check` | Passed, including the full suite total above | `build-check.log` |
| `pnpm changeset status --since=origin/main` | Passed; aiCore minor release only | `changeset-status.log` |
| `swift test --package-path packages/system-speech/native` | 8 tests passed | `swift-final.log` |
| `CHERRY_EDITION=global node node_modules/electron-vite/bin/electron-vite.js build` | Real Cherry app bundle built | `bundle.log` |
| Production IPC, explicit `zh-CN` Apple models | Complete TTS WAV, actual WebM recording, nonempty ASR, all 3 sessions discarded | `production-ipc-zh.json` |
| Production negative routes | `VOICE_VOICE_UNAVAILABLE`, `VOICE_ASSET_REQUIRED`, `VOICE_ABORTED`; repeated abort succeeded | `production-negative.json` |
| Same production IPC under the offline policy below | Same successful Apple metadata; explicit FunASR refused | `offline-pipe-output.json` |
| TCP probe under the same OS policy | Denied with `EPERM` | `offline-network-probe.json` |
| `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --arm64 --dir --publish never -c.mac.identity=-` | Actual `dist/mac-arm64/Cherry Studio.app` built with ad-hoc signing | `package-mac-arm64.log` |
| `node packages/system-speech/scripts/smoke-packaged.cjs 'dist/mac-arm64/Cherry Studio.app'` | App/helper signatures, executable mode and helper capabilities passed | `packaged-helper-smoke.json` |

The Apple round trip used an installed `zh-CN` voice and already installed ASR
assets. It produced a 515,624-byte WAV, a 63,366-byte `audio/webm;codecs=opus`
recording, and `transcriptNonEmpty: true` for 7.98 seconds of ASR audio. The reported
48 kHz in the harness is the AudioContext decode-buffer rate, not a claim about
the stored TTS WAV rate. No speech text or audio payload is retained in these logs.
The initial `en-US` run returned `asset_required`; choosing an explicitly requested
test locale with installed assets did not download resources or change engines.

The offline process ran the real Cherry entry point under:

```text
(version 1)(allow default)(deny network*)
(allow network-bind network-inbound (local unix-socket (regex #".*/SingletonSocket$")))
```

A bare `(deny network*)` prevents Electron's single-instance Unix socket from
binding. The successful test permits only that local socket's bind/inbound access;
TCP/UDP remain denied, including loopback (independently observed as `EPERM`). CDP
used inherited pipes. The test-only launch used `--no-sandbox` because Chromium's
nested sandbox conflicted with this external macOS sandbox; the outer OS network
restriction still covered the process tree. This is not an unchanged production
Chromium sandbox validation.

Packaged evidence covers the **helper inside the actual app**, not packaged UI
IPC. Production IPC evidence uses the built Cherry app in the isolated tracked
development profile. Local ad-hoc signing is not Developer ID or notarization
validation. x64 was compiled but not executed. File unlinking inherits FileManager's
existing best-effort behavior on filesystem failures.

FunASR was explicitly selected through the same WebM/FileEntry route and returned
`license_unverified` in both normal and offline runs. This proves stable refusal,
not FunASR transcription. Model/runtime download, exact missing-byte accounting,
and actual FunASR inference remain release-blocked by provenance and licensing.
