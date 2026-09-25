# Apple system speech

Private native boundary for Cherry Studio's local Voice Runtime. The production
Main adapters own platform checks, temporary paths and cancellation; this package
owns the Apple frameworks and its typed subprocess protocol. It is selectively
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
executable outside asar into `Contents/Resources/system-speech` and signs it as
nested application code. End users need no Swift, Xcode, Rust or ffmpeg.

The JavaScript build preserves the independently compiled native output. Production
packaging must verify executable permissions, the nested helper's strict signature,
the absence of helper entitlements, matching helper/app Mach-O architectures, the
app's deep strict signature, and a capabilities round trip. The helper is signed with
its dedicated empty entitlement policy rather than Electron's inherited relaxations.
A packaged helper smoke does not replace VoiceSessionService/IpcApi integration verification.

The Windows SAPI helper under `windows/` is an isolated proof of concept. It is
not yet packaged or selected by the Voice Runtime; see its README for the
Windows x64 build and device checks.
