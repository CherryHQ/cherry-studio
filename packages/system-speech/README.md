# System speech helpers

Private native boundary for Cherry Studio's local Voice Runtime. The production
Main adapters own platform checks, temporary paths and cancellation; this package
owns the Apple frameworks, Windows SAPI and their typed subprocess protocol. It is selectively
rebuilt from validation PR #20733, not a validation application.

`capabilities` and `transcribe` never request asset installation. On macOS 26 or
later, only the explicit `install_asr_assets` command with `confirmDownload: true`
installs Apple ASR assets. On macOS 13–15, ASR uses `SFSpeechRecognizer` only when
the requested language supports on-device recognition; it never falls back to
Apple's network recognition. The older API requests speech authorization at first
transcription and does not offer asset installation. TTS requires macOS 13 or later
and the exact installed voice identifier; missing voices are never substituted.

Native requests travel over stdin, never command-line arguments. Protocol failures
discard stderr and arbitrary errors. Aborting or timing out waits for helper exit
before returning, so Main can safely remove request-owned files. No transcript,
text, audio or user path is logged by the package.

## Build and test

`pnpm dev`, `pnpm debug`, `pnpm dev:watch` and `pnpm start` prepare the native helper
on supported Windows and macOS hosts. They build it when missing or older than its
native sources, and reuse the existing executable otherwise. Run
`pnpm prepare:system-speech` to prepare it independently. `pnpm install` builds only
the JavaScript boundary; native preparation requires the platform build tools below.

```sh
pnpm --filter @cherrystudio/system-speech test
pnpm --filter @cherrystudio/system-speech typecheck
pnpm --filter @cherrystudio/system-speech test:native
pnpm --filter @cherrystudio/system-speech build
pnpm --filter @cherrystudio/system-speech build:native -- --arch arm64
pnpm --filter @cherrystudio/system-speech smoke:packaged -- '/path/Cherry Studio.app'
```

Maintainers need Xcode 26 or later to compile the Swift helper. `before-pack.js`
builds the requested macOS target architecture, then electron-builder copies the
executable outside asar into `Contents/Helpers/cherry-system-speech` and signs it as
nested application code. End users need no Swift, Xcode, Rust or ffmpeg.

The JavaScript build preserves the independently compiled native output. Production
packaging must verify executable permissions, the nested helper's strict signature,
the absence of helper entitlements, matching helper/app Mach-O architectures, the
app's deep strict signature, and a capabilities round trip. The helper is signed with
its dedicated empty entitlement policy rather than Electron's inherited relaxations.
A packaged helper smoke does not replace VoiceSessionService/IpcApi integration verification.

Windows x64 system ASR and TTS use the SAPI helper under `windows/`. On Windows
x64, `resolveDefaultAsrModel` recommends `local-voice::windows-system-asr` when
no model is explicitly selected. An explicit selection is preserved. A `probe_asr` request initializes the installed recognizer and
dictation grammar before transcription; it does not activate a microphone or
install assets. Main decodes recorded WebM/Opus through the same utility process
as Apple ASR, then sends the derived mono 16 kHz WAV to SAPI. Its build and
packaging are architecture-gated; Windows ARM64 system speech is unsupported
without blocking ARM64 application packages. See the [Windows helper guide](./windows/README.md)
for build prerequisites, independent protocol and real ASR/TTS smokes, packaged
helper signature checks, and the remaining NSIS/portable device acceptance.
The native synthesis protocol requires an explicit `speed` from 0.5 to 2;
Apple and Windows adapters both forward the selected speed.

## Apple PCM streaming

`SystemSpeechNativeClient.stream()` accepts `synthesize_stream` with an exact installed
voice, complete text and speed. It returns an early `output` promise (format plus a
single-consumer PCM iterator), `completed`, `closed`, and idempotent `cancel()`.
Completion requires valid protocol EOF and successful helper exit; closure only
confirms resource release. Neither means that the renderer has finished playback.

The Apple callback writes bounded NDJSON directly to stdout: one `format`, ordered
`pcm` messages containing base64 Float32 little-endian interleaved samples, then an
`end` message with the exact frame count. Each chunk contains at most 1,024 frames,
one or two channels, and each line is capped at 16 KiB. Error envelopes retain the
existing stable error codes. Missing voices are not substituted. There is no WAV
scratch file in this path; complete synthesis and Windows requests are unchanged.

The callback writes synchronously to the bounded OS pipe. Node pulls stdout only
as downstream consumes it, retaining at most its readable buffer, one read batch
and an incomplete protocol line. This bounds transport storage, not the system
speech engine's internal allocation. The producer-read deadline (120 seconds by
default) runs only during pending reads or exit acknowledgement, not during a
downstream pause. The owning application must retain its session deadline.
Cancelling or ending iteration early terminates the helper and joins child/stdio
closure before returning. Malformed output, discontinuities and missing EOF fail
without exposing native diagnostics.
