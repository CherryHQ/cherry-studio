# Local Voice Runtime foundation

## Scope

This is a production implementation rebuilt from the technical evidence in
[Apple validation #20733](https://github.com/CherryHQ/cherry-studio/pull/20733)
(up to `3ac951ed5f`) and [FunASR validation #20734](https://github.com/CherryHQ/cherry-studio/pull/20734)
(up to `4ef2192992`). Neither validation PR is formal PR1/PR2 in the original
[#19797](https://github.com/CherryHQ/cherry-studio/issues/19797) four-PR stack;
neither is merged or cherry-picked as a dependency.

This PR1 is the updated **local-only Voice Runtime foundation**, not completion
of all consumers or the issue milestone. Formal PR2 owns Preferences, Renderer
Voice Client, Dictation Controller, Speech Playback Controller, and Settings test UI.
No Composer, Notes, Translate, microphone, playback UI, voice history, new SQLite
tables, migrations, or DataApi routes are part of this change.

## Implementation and acceptance

The shared operations and model facts, strict IPC routes, lifecycle session owner,
private decoder, Apple adapter and native package, packaging wiring and FileManager
runtime retention are implemented with focused contract tests. Repository gates
passed. The real production IPC chain completed Apple TTS → WebM FileEntry →
Apple ASR on macOS 26.3 arm64, including a run under an OS network-denial policy.
The actual packaged Cherry Studio app passed helper executable/signature/capability
checks with local ad-hoc signing. Developer ID signing and notarization were not
validated. See the implementation plan for measured results and offline-test limits.

FunASR remains blocked: its identity and stable `license_unverified` response are
implemented, but no FunASR catalog, model/runtime download or inference adapter is
published. No substitute model is selected. Real validation is limited to the
current macOS 26.3 arm64 machine; cross-platform native execution is unverified.

## Production path

```text
immutable local model facts / pure default resolution
  -> Renderer typed IpcApi
  -> VoiceSessionService (owner, admission, cancellation, files)
  -> AiService (local model resolution)
  -> aiCore generateSpeech / transcribe (one-shot SDK model contract)
  -> Main private local adapter
  -> Apple helper / isolated WebM decoder
  -> temporary WAV FileEntry / transcript
```

Existing Painting methods in AiService demonstrate the operation-to-FileManager
boundary. Existing SDK provider types already include speech/transcription, and
localEmbedding demonstrates stable local model identities and capability facts.
Reuse these without introducing `supportsVoice`, a remote voice provider,
provider credentials, HTTP tracing, or AiStreamManager.

Model identities are `local-voice::apple-system-asr`,
`local-voice::apple-system-tts`, and `local-voice::funasr-nano`. Existing
AUDIO_TRANSCRIPT/AUDIO_GENERATION capabilities and input/output modalities express
purpose. An unset ASR selection recommends Apple on macOS 26+, FunASR on older
macOS. Explicit selections are preserved even when unavailable. Resolution has
no resource-service dependency and cannot download, retry another engine, or fall back.

## Alternatives and boundaries

1. Thin IPC routes calling native helpers directly avoid aiCore changes but omit
   the required first-class operations and duplicate AI model validation.
2. AiService-only voice helpers reuse the coordinator but leave aiCore without a
   speech/transcription contract. Product consumers would diverge again.
3. Selected: engine-independent aiCore operations using existing SDK V3 model
   interfaces, with private Main model factories. These operations remain useful
   to future voice consumers independently of any Composer integration.

IpcApi changes are domain routes and schemas, not transport-framework changes.
UtilityProcess changes are consumer definitions/entries, not a generic codec
service or framework rewrite. No persistence-system change is needed.

FileManager's existing grace period is explicitly not a lease. A live retry or
playback session can outlast it. A `manual` entry survives crashes indefinitely;
refreshing `createdAt` mutates persistence and still races GC. A small runtime
retain/release API in FileManager makes cleanup respect active consumers and
remains a general file-lifetime capability if Voice is removed. It does not
override explicit deletion or add a persistent reference table. Retained IDs are
excluded before the candidate batch limit, preventing older active entries from
starving later orphans. The live reference map is rechecked inside each synchronous
delete transaction. Independent disposables are idempotent and cleared on stop;
an old disposal cannot release a later consumer's reference.

## IPC and temporary file ownership

The four operation routes are `ai.speech.generate`, `ai.speech.abort`,
`ai.transcription.generate`, and `ai.transcription.abort`.

ASR input contains sessionId, requestId, modelId, fileEntryId, standard locale,
and bounded non-sensitive source metadata. Strict schemas reject paths, bytes,
base64, arbitrary provider parameters, and adapter names. Main derives the owner
from IpcContext and WindowManager, never from a caller-provided owner field.

A narrow `file.voice_recording.create` route registers WebM/Opus bytes via
FileManager and binds the new entry to its owning Voice session. Bytes are
accepted only on this file-registration boundary, never on AI generation routes.
Only those registered entries may be used for ASR; knowing another entry's ID
confers no ownership. Main checks origin, cleanup policy, size, MIME/actual
container and codec, and current ownership on every request.

`ai.voice.session.discard` releases retained failed input or successful TTS output.
Read-only model/resource discovery and explicit Apple asset installation have
separate routes. Asset installation never happens during discovery or inference.
No event is needed for one-shot results in PR1.

A global synchronous lease is acquired before the first awaited admission work.
A competing operation is rejected as busy; PR1 has no inference queue. Pending
registration/install work is tracked and cancelled/joined during shutdown.
Request IDs cannot silently replace an in-flight request. Abort is owner-scoped
and idempotent, waits for native work to stop, and releases owned files.

Successful ASR deletes input; failed ASR retains it only in the current live
session for explicit retry/discard. Owner destruction, abort, discard, stop,
and destroy release it. Successful speech returns an internal
`delete_when_unreferenced` WAV FileEntry without a physical path. The session
retains it until discard/owner teardown. Scratch output is never left untracked.

## WebM/Opus decoding

Compare two feature-local approaches:

- Mediabunny WebM demux plus `opus-decoder` WASM: maintained libraries, no runtime
  downloads or OS codec dependency, CPU isolation through existing UtilityProcess.
  Must account for Opus pre-skip/end padding and bound decoded duration/memory.
- Restricted Chromium conversion: existing browser decoder support, but requires
  hidden-window ownership, an isolated no-network session, navigation restrictions,
  and a private byte-return channel. It adds a larger lifetime/security surface.

Choose pinned Mediabunny 1.58.0, opus-decoder 0.7.12 and ts-ebml 3.0.2. ts-ebml
supplies pre-skip/discard-padding metadata not exposed by the demux API. The decoder is private to
Voice local adapters. It accepts the original WebM/Opus data and produces mono
16 kHz PCM16 WAV; Apple and a future licensed FunASR adapter use the same format.
Abort terminates the utility generation before session lease release. Real WebM
fixtures protect against accidentally replacing this contract with WAV-only input.
Retain dependency licenses/attribution in source and packaged resources; never
invoke system ffmpeg.

The accepted recording subset has one mono/stereo Opus track, OpusHead version 1,
mapping family 0, zero output gain and unlaced blocks. Reject unsupported track,
lacing, encryption, padding and metadata encodings rather than guessing. Bound
encoded input to 32 MiB, decoded duration to five minutes and metadata to 200,000
elements; a 30-second host timeout terminates stalled decoder work. See the
[decoder contract](../../../src/main/ai/voice/localAdapters/README.md) for exact limits.

## Apple adapter and distribution

Selectively reuse the Swift package, capability/voice discovery, on-device ASR,
explicit asset install, exact voice identity, and valid WAV encoding. Do not
reuse the validation application, routePolicy, Renderer AudioContext converter,
or validation CLI. Native response validation is operation-specific; stdout is
protocol data only and stderr is never logged verbatim. Timeout/abort waits for
confirmed child exit before returning, with bounded termination escalation.

Resolve helper and scratch paths through application.getPath. macOS build tooling
produces an executable helper, copies it into real application resources, and
includes it in signing. Users require no Swift, Xcode, Rust, or ffmpeg. Validate
both tracked development Electron and the packaged Cherry app. Only the current
macOS 26.3 arm64 machine is a real-validation target.

## FunASR release blocker

The ONNX mirror revision `6f16bd378457e13f36ccf3910df9017f96c346fb` identifies
ModelScope `zengshuishui/FunASR-nano-onnx` and Wasser1462's export scripts, but has
no license metadata, LICENSE/NOTICE, original checkpoint revision, or export
commit linkage. The original model's current Apache-2.0 metadata at revision
`272c57b82523ada6fd87095e955f8e29100979ab` does not establish which revision
produced the January 2026 conversion. The toolkit's Model License 1.1 cannot be
assumed to govern a model merely because it is in that toolkit.

Therefore FunASR has an explicit `license_unverified` failure state and no
production download/catalog entry. Do not substitute another model. Porting its
catalog-dependent inference service as unreachable code would not establish a
production closure, so that portion remains blocked. sherpa-onnx runtime
Apache-2.0 does not cure missing model provenance.

Evidence:

- [ONNX model card](https://huggingface.co/csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30)
- [sherpa model provenance](https://k2-fsa.github.io/sherpa/onnx/funasr-nano/pretrained.html)
- [Original model card at revision](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512/raw/272c57b82523ada6fd87095e955f8e29100979ab/README.md)
- [FunASR license scope](https://github.com/modelscope/FunASR#license)

Unblocking requires conversion provenance, applicable license and attribution,
then the pinned checksum catalog, exact missing download byte accounting,
LocalModelService atomic install/cancel/retry/remove, CPU-only ASR utility service,
and real inference through the same WebM FileEntry route. No approximate progress
weights are presented as actual byte sizes, and no mainland-China mirror claim is made.

## Lifecycle analysis

### Verdict + confidence + rationale

Lifecycle required, high confidence: the service owns surviving failed recordings,
output entries, window listeners, cancellation controllers and a global lease.

### Evidence

FileManager owns physical files and cleanup; WindowManager owns WebContents;
UtilityProcessManager owns native-worker generations. VoiceSessionService owns
the session relationships and joins cancellation across these resources.

### Over-design assessment

No activation interface is needed for the small session map; heavy decoder
resources already have on-demand lifetime in UtilityProcessManager. No global UI
channel, persistent voice session, shared cache, or automatic fallback is added.

### Alternatives considered

An ordinary function cannot retain failed input across calls. A manual singleton
has no coordinated shutdown. AiService and AiStreamManager own AI execution and
chat streams, not voice file/owner sessions. A narrow new service is justified.

### Recommended lifecycle design / Not applicable

Place VoiceSessionService under src/main/ai/voice, Phase.WhenReady, ordered after
AiService, FileManager, WindowManager and UtilityProcessManager as needed. No
redundant BeforeReady dependencies. onInit opens admission and registers decoder
ownership; onStop closes admission synchronously, aborts and joins work, deletes
session files and removes listeners; onDestroy repeats cleanup idempotently.
Native/decoder termination is bounded, and a lease is not released before exit.
Partial file creation rolls back. Crash remnants use existing automatic cleanup.

### Implementation ownership

Keep model facts, IPC schema, session ownership, engine adaptation, decoder entry,
and native package distinct. Verify owner isolation, admission, failure retry,
stop/restart, native termination, and real FileManager cleanup independently.

### Open evidence

FunASR conversion license/provenance and cross-platform native testing remain
release limitations. The real WebM fixture tests now cover Opus pre-skip and terminal discard padding.
Production IpcApi inference under denied network and the packaged helper's local
ad-hoc signing/smoke are recorded in the implementation plan. Those results do
not establish Developer ID signing, notarization, packaged renderer IPC, or
platform coverage beyond the tested macOS 26.3 arm64 machine.

## Privacy and acceptance

Voice logs contain only IDs, model/adapter, locale, MIME, duration, normalized text
length, state, timing, and stable error category. No transcript, TTS text, bytes,
physical user path, credentials, stderr, or complete native/provider response is
logged. Tests inject sensitive sentinel values into failures to prove redaction.

Run focused aiCore/Main/shared/native tests first, then pnpm lint, test:lint,
docs:check, build:check and changeset status --since=origin/main. aiCore is public,
so its new operation surface needs a real changeset. Real local inference runs
through production IpcApi/VoiceSessionService with network denied; report metadata
and transcriptNonEmpty only. Do not equate a direct-helper test with that proof.
