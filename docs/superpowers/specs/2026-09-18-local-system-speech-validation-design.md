# Local System Speech Validation Design

## Goal

Validate a fully local macOS ASR and TTS path before implementing the full Voice product stack from issue 19797. The validation must prove that Cherry can keep WebM/Opus as its shared recording format, adapt that recording to Apple Speech without Rust or ffmpeg, and preserve explicit user control over every model or voice download.

The resulting production direction is:

- macOS 26 and later use Apple `SpeechAnalyzer` and `SpeechTranscriber` for ASR.
- macOS versions before 26 use the FunASR implementation from PR 19981.
- Apple `SFSpeechRecognizer` is not used.
- TTS uses installed macOS voices through `AVSpeechSynthesizer`.
- ASR and TTS never fall back to a remote Provider or upload audio.

## Scope

This validation covers:

1. Discovering Apple Speech locale and asset readiness without starting a download.
2. Starting an Apple Speech asset installation only through a distinct, explicit operation.
3. Synthesizing text to a complete local WAV file with an installed macOS voice.
4. Converting a Chromium-produced WebM/Opus recording to mono PCM/WAV inside the Apple ASR adapter.
5. Transcribing the derived WAV locally with Apple Speech.
6. Verifying that the ready-state transcription and synthesis paths work with network access denied.
7. Confirming that the pre-macOS-26 route resolves to FunASR and never to `SFSpeechRecognizer` or a remote Provider.

The validation does not add Settings UI, Composer controls, auto-read, shared playback UI, persistent preferences, cross-window session coordination, or production packaging. It does not download or run FunASR unless the user separately triggers the model download.

## Architecture

### Workspace package

Create an internal workspace package named `@cherrystudio/system-speech`. It contains a TypeScript facade and a Swift command-line helper. It is not published to npm and does not use `napi-rs`.

```text
packages/system-speech/
├── package.json
├── src/
│   ├── index.ts
│   ├── contracts.ts
│   └── webmToWav.ts
├── native/
│   ├── Package.swift
│   └── Sources/SystemSpeechHelper/
│       ├── main.swift
│       ├── AppleAsr.swift
│       └── AppleTts.swift
└── tests/
```

The TypeScript facade owns process invocation and WebM/Opus conversion. The Swift helper owns only Apple framework calls. Product policy remains outside this package.

### Process boundary

The Swift helper is invoked as a bounded child process. Each command performs one operation and exits. Inputs and results use JSON on standard input and standard output; audio travels through temporary files, never as JSON or base64.

One-shot processes are intentional for the validation:

- cancellation terminates the one operation without retaining native state;
- a Swift or Apple framework failure cannot crash Electron's main process;
- no resident helper lifecycle, restart protocol, or native Node ABI is required;
- the helper can be run under a network-denying validation profile.

The production Voice layer may reuse this process boundary. The future `VoiceSessionService`, rather than this package, owns admission, request IDs, cancellation, and cross-window state.

## Capability and download contract

The helper exposes separate conceptual operations:

| Operation | Behavior |
| --- | --- |
| `capabilities` | Reports OS support, supported locale, Apple Speech asset readiness, and installed TTS voices. It never downloads. |
| `install-asr-assets` | Requests installation for one explicitly selected locale. This is the only Apple ASR operation allowed to initiate a download. |
| `transcribe` | Requires already-ready assets and a local PCM/WAV input. If assets are missing, returns `asset_required` without installing them. |
| `synthesize` | Requires an installed voice and writes local WAV output. If the voice is absent, returns `voice_unavailable`. |

macOS does not provide an application API for silently installing arbitrary enhanced TTS voices. The application therefore lists only installed voices. A missing requested voice is resolved through an explicit user journey to macOS voice settings; synthesis never substitutes a different voice silently.

## ASR routing

Runtime selection is deterministic:

```text
macOS >= 26 and Apple locale/assets ready
  -> Apple SpeechTranscriber

macOS >= 26 and Apple asset missing
  -> asset_required

macOS < 26 and FunASR installed
  -> FunASR

macOS < 26 and FunASR missing
  -> model_required
```

There is no `SFSpeechRecognizer` branch and no remote fallback. Tests inject the OS capability result to verify both routes without pretending that the current macOS 26 host is an older system.

## WebM/Opus conversion

The shared Dictation Controller continues to record `audio/webm;codecs=opus`. The Apple adapter performs conversion before invoking Swift:

1. Register and retain the original WebM/Opus recording as the live session's temporary source.
2. Decode that recording with Electron's Chromium `AudioContext.decodeAudioData`.
3. Downmix decoded channels to mono.
4. Resample to 16 kHz PCM for a bounded, predictable ASR input.
5. Encode a valid little-endian PCM WAV header and samples in TypeScript.
6. Register the WAV as an adapter-derived temporary FileEntry.
7. Pass only the derived WAV path to the Swift helper.

The conversion remains internal to the Apple adapter. Callers continue to submit the original WebM/Opus recording and do not know about WAV.

The five-minute recording limit bounds memory. The adapter releases decoded `AudioBuffer`, intermediate channel data, and derived WAV references on success, discard, replacement, owner destruction, or app exit. A failed Apple transcription retains the original WebM/Opus source for same-session retry; a derived WAV may be regenerated locally without Provider cost.

If Electron 44 cannot decode the exact `MediaRecorder` WebM/Opus output during the validation, this design is rejected rather than adding ffmpeg implicitly. A separate decision would then compare a narrow Opus decoder with changing the shared recording format.

## Apple ASR

The Swift helper uses only APIs available from macOS 26:

- `SpeechTranscriber.supportedLocale(equivalentTo:)` for locale selection;
- `AssetInventory` for readiness and explicit installation;
- `SpeechAnalyzer` with `AVAudioFile` input;
- finalized results for the initial non-streaming dictation contract;
- `cancelAndFinishNow()` when the helper receives cancellation before process termination.

`SpeechAnalyzer` and `SpeechTranscriber` are on-device APIs. The helper does not import or call networking libraries and never instantiates `SFSpeechRecognizer`.

## Apple TTS

The Swift helper enumerates installed `AVSpeechSynthesisVoice` values and exposes stable identifiers, locale, name, quality, and whether the voice is the current default where available.

Synthesis uses `AVSpeechSynthesizer.write(_:toBufferCallback:)`, writes the returned PCM buffers into a complete WAV file, and reports the actual output format. Playback remains outside the helper so Cherry can use the shared playback controller and temporary FileEntry contract.

The helper never calls `speak()` for product playback, never changes the system default voice, and never substitutes an unavailable voice.

## Local-only guarantee

The design enforces local-only behavior through capability selection and observable failure:

- Apple ASR is limited to `SpeechAnalyzer`/`SpeechTranscriber` on macOS 26+.
- Earlier macOS uses installed FunASR weights through sherpa-onnx.
- TTS uses installed `AVSpeechSynthesisVoice` resources.
- Missing assets or voices produce explicit errors instead of fallback.
- No remote Provider adapter is reachable from the system-speech package.
- Logs contain identifiers, durations, formats, and status only; they never contain transcript text, synthesis text, or audio bytes.

After an explicitly requested asset installation completes, the validation reruns transcription and synthesis with outbound networking denied for the helper process. Passing this check is required evidence for the local-only claim.

## Error contract

The facade normalizes native and conversion failures into these validation errors:

- `unsupported_os`
- `unsupported_locale`
- `asset_required`
- `asset_installation_failed`
- `voice_unavailable`
- `unsupported_recording_format`
- `audio_decode_failed`
- `audio_conversion_failed`
- `transcription_failed`
- `synthesis_failed`
- `cancelled`

No error triggers retry, model installation, voice substitution, Provider invocation, or upload.

## Verification

The validation succeeds only when all of the following evidence exists:

1. On macOS 26.3 arm64, `capabilities` reports the actual supported Chinese locale and asset state without changing it.
2. `transcribe` with absent assets returns `asset_required`; only `install-asr-assets` can change readiness.
3. An installed local voice synthesizes a browser-playable WAV containing non-empty PCM audio.
4. Electron 44 records or constructs a real WebM/Opus fixture, the TypeScript adapter converts it to valid mono PCM/WAV, and duration remains within a small tolerance.
5. Apple Speech transcribes that derived WAV into non-empty text.
6. The ready-state ASR and TTS checks pass while outbound networking is denied.
7. Cancellation terminates conversion or the Swift helper and removes derived output.
8. Route tests select Apple only for macOS 26+, FunASR below 26, and never select `SFSpeechRecognizer` or a remote Provider.
9. A packaged-helper smoke check confirms the executable is found, executable, correctly signed, and runnable from the expected application resource location before production integration begins.

Intel macOS and an actual pre-macOS-26 packaged run remain required before claiming full platform support; the current Apple Silicon/macOS 26 host cannot establish those results.

## Security and privacy

The helper accepts only paths created and resolved by Cherry's FileEntry layer. Arbitrary renderer-provided physical paths never cross the command boundary. Output paths are allocated by Main through the centralized application path registry.

Microphone capture remains in a trusted Cherry renderer after an explicit click. The native helper receives recorded files and does not open the microphone itself. Existing `NSMicrophoneUsageDescription` remains sufficient for recording; production integration adds `NSSpeechRecognitionUsageDescription` only if the selected Apple API or packaged runtime proves it is required.

## Follow-on implementation boundary

Successful validation authorizes an implementation plan for the internal package and its build artifacts. It does not authorize the wider issue 19797 UI or Voice orchestration stack. That later work must consume this package through the shared Voice client and `VoiceSessionService` contracts rather than calling the Swift helper directly from product surfaces.
