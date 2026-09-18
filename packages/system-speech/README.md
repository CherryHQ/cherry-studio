# System Speech Validation

`@cherrystudio/system-speech` validates Cherry Studio's local macOS speech path. It contains a browser-only WebM/Opus adapter, a Node child-process client, and a Swift helper built with Apple system frameworks.

The package never calls a remote speech provider. `capabilities`, `roundtrip`, and `offline` do not download speech assets. The only command allowed to request an Apple ASR asset download is:

```bash
pnpm --filter @cherrystudio/system-speech validate -- install-asr-assets --locale zh-CN --confirm-download
```

Run that command only after the user explicitly requests the download. Missing ASR assets return `asset_required`; unavailable voices return `voice_unavailable` without substitution. All audio input and output uses caller-owned local paths.

End users do not need Rust, Swift, Xcode, or ffmpeg. Release builds ship the precompiled Swift helper. Maintainers need Xcode 26 or later only when building the macOS helper.

## Development checks

```bash
pnpm --filter @cherrystudio/system-speech test
pnpm --filter @cherrystudio/system-speech typecheck
pnpm --filter @cherrystudio/system-speech build
pnpm --filter @cherrystudio/system-speech test:native
```

Runtime validation commands are added with the validation runner. Generated audio and transcripts must not be committed or written to logs.
