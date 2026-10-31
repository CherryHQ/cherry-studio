# Agent Note: FunASR compatibility decoder and existing installations

Status: implemented

English | [中文](2026-10-31-funasr-compat-decoder.zh.md)

## Problem

[Issue #23110](https://github.com/CherryHQ/cherry-studio/issues/23110) reports Chinese repetition loops and hallucinated text with the old FunASR Nano int8 decoder. [The upstream fix](https://github.com/k2-fsa/sherpa-onnx/pull/3493) switches to `llm_int8_compat/llm.int8.onnx`. Updating only the catalog URL and checksum leaves existing installations on the old weights: readiness checks existence and a minimum size, and both decoder files exceed that floor.

## Decision

The catalog pins the compatibility decoder from ModelScope revision `ce0975f2a7a8ad6441223db59ce6e1362295ddfe` and installs it as `llm.int8.compat.onnx`. The bundle ID stays unchanged. Existing installations require only that decoder; inference refuses the old-only installation and resolves the new filename after repair. Download hashing and atomic publication remain owned by the existing acquisition layer.

The old Hugging Face revision still serves incompatible bytes, so it and its mirror are excluded from this file's sources. Other bundle files retain their verified sources. [Local Models](../../../../docs/references/ai/local-models.md) owns the installation behavior.

## Alternatives considered

- Change only the URL and digest: existing installations still pass the size floor and keep loading the old decoder.
- Hash every readiness query: adds a roughly 600 MB read to repeated status checks when a distinct filename already identifies the required generation.
- Replace the entire bundle or switch to FP16: unnecessarily downloads unchanged files or changes the model's resource requirements.
- Delete the old decoder during scanning: turns a read path into destructive migration logic and can conflict with open native handles.

## Consequences

Users with old installations see the existing incomplete-install state and can retry the model download. Only the roughly 600 MB decoder is fetched. The old decoder remains unused, consuming roughly 600 MB until model removal deletes the bundle root. There is no fallback to the incompatible weights if download fails. This decoder has one verified download source. Quantization compatibility and the KV-window chunk budget remain independent fixes.

## Verification

- Regression — `src/main/ai/localModel/installation/__tests__/funasrUpgrade.test.ts`: all four cases fail before the catalog change; real filesystem scans reject old-only and partial installs, request only the decoder, and resolve the compatible path when both generations exist. The catalog check rejects the old digest and sources.
- Regression — SHA-256 of the downloaded 600,339,316-byte decoder matches `7f0c5a508b41474b1b1ec1cdbdefafd2cf8b3642c6915a0a425265b7b7d2c960`.
- Manual Electron verification — an isolated profile with unchanged model files and a sparse old-decoder readiness fixture showed an incomplete installation. Retrying downloaded the real compatibility decoder and changed the model card to ready.
- Manual macOS arm64 transcription — the production ASR service and utility process transcribed the official math and biochemistry samples correctly. The distant-speech sample had recognition errors but no repetition loop. No E2E test is added for this fix.

Windows AVX2 transcription acceptance requires the affected hardware; filesystem and catalog checks do not prove recognition accuracy on that CPU.
