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

Windows x64 system TTS uses the SAPI helper under `windows/`. Its build and
packaging are architecture-gated; Windows ARM64 system speech is unsupported
without blocking ARM64 application packages. See the [Windows helper guide](./windows/README.md)
for build prerequisites, independent protocol and real TTS smokes, packaged
helper signature checks, and the remaining NSIS/portable device acceptance.
The native synthesis protocol requires an explicit `speed` from 0.5 to 2;
Apple and Windows adapters both forward the selected speed.
