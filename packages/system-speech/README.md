# System Speech Validation

`@cherrystudio/system-speech` validates Cherry Studio's local macOS speech path. It contains a browser-only WebM/Opus adapter, a Node child-process client, and a Swift helper built with Apple system frameworks.

The package never calls a remote speech provider. `capabilities`, `roundtrip`, and `offline` do not download speech assets. The only command allowed to request an Apple ASR asset download is:

```bash
pnpm --filter @cherrystudio/system-speech validate -- install-asr-assets --locale zh-CN --confirm-download
```

Run that command only after the user explicitly requests the download. A `supported` asset status means the locale is available but its ASR asset is not installed. Missing ASR assets return `asset_required`; unavailable voices return `voice_unavailable` without substitution. All audio input and output uses caller-owned local paths.

End users do not need Rust, Swift, Xcode, or ffmpeg. Release builds ship the precompiled Swift helper. Maintainers need Xcode 26 or later only when building the macOS helper.

## Development checks

```bash
pnpm --filter @cherrystudio/system-speech test
pnpm --filter @cherrystudio/system-speech typecheck
pnpm --filter @cherrystudio/system-speech build
pnpm --filter @cherrystudio/system-speech test:native
```

Runtime validation commands are added with the validation runner. Generated audio and transcripts must not be committed or written to logs.

## Runtime validation

Build the package and the helper before running validation:

```bash
pnpm --filter @cherrystudio/system-speech build
pnpm --filter @cherrystudio/system-speech build:native
pnpm --filter @cherrystudio/system-speech validate -- capabilities --locale zh-CN
```

After the user has explicitly installed the reported ASR asset, select an exact voice ID from `capabilities` and run:

```bash
pnpm --filter @cherrystudio/system-speech validate -- roundtrip --locale zh-CN --voice-id '<voice-id>' --text '你好，Cherry Studio。'
pnpm --filter @cherrystudio/system-speech validate -- offline --locale zh-CN --voice-id '<voice-id>' --text '你好，Cherry Studio。'
```

`roundtrip` synthesizes a local WAV, records it as WebM/Opus in Electron, converts it to mono 16 kHz WAV in the Apple adapter, and transcribes it locally. `offline` runs the same speech operations with network access denied by the macOS sandbox. Both commands delete temporary audio and report only metadata plus whether the transcript was nonempty.

Before a macOS release, also verify the helper inside an unpacked signed application:

```bash
pnpm build
pnpm --filter @cherrystudio/system-speech build:native
pnpm exec electron-builder --dir --mac --arm64 --config packages/system-speech/validation/packaging/electron-builder.yml
pnpm --filter @cherrystudio/system-speech validate:packaged -- '.validation-pack/mac-arm64/Cherry Studio.app'
```

## Validation evidence

| Item | Result on 2026-09-18 |
| --- | --- |
| Host | macOS 26.3, arm64 |
| Runtime toolchain | Electron 44.2.0; Apple Swift 6.3.3 |
| End-user toolchains | `rustc` and `ffmpeg` absent |
| Locale | Requested `zh-CN`; Apple resolved `zh_CN` |
| Apple ASR asset | Initial `supported`; explicit install completed with `zh_CN / installed` |
| Apple TTS | Exact compact `zh-CN` voice produced mono 22.05 kHz WAV |
| Shared recording | `audio/webm;codecs=opus`; system identified the output as WebM |
| Apple adapter output | PCM16 WAV, mono, 16 kHz |
| Conversion duration | Source 1.311875 s; derived 1.26 s; difference 0.051875 s |
| ASR round trip | TTS → WebM/Opus → mono 16 kHz WAV → Apple ASR returned non-empty text |
| Network-denied round trip | Same pipeline returned non-empty text under `sandbox-exec` with outbound networking denied |
| Packaged helper | Owner-executable, Developer ID signed, nested strict verification passed, capabilities response passed |
