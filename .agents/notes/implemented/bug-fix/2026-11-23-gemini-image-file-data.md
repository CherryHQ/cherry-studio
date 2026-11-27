# Agent Note: Download Gemini relay image URLs

Status: implemented

English | [中文](2026-11-23-gemini-image-file-data.zh.md)

## Problem

[#25121](https://github.com/CherryHQ/cherry-studio/issues/25121) reports that a Gemini-compatible relay returns image parts as either `inlineData` or `fileData.fileUri`. The pinned Google SDK collects only inline image bytes, so a successful response containing only an image URL reaches Painting as an empty result.

## Decision

Extend the existing Google SDK patch in the Gemini image model to emit HTTP(S) image URLs from the selected response candidate. The AI SDK image download hook handles those URLs before persistence. The Google image download path uses the shared public-network fetcher with pinned DNS, redirect validation, cancellation, and a byte limit. If every result is lost to download failure, Painting shows a localized download error.

## Alternatives considered

- Parsing image links in the text response would depend on optional model-authored Markdown.
- Downloading inside the Google SDK would bypass the app's download policy and duplicate its media handling.

## Consequences

Inline image handling and other provider downloads retain their existing paths. Google image URLs use a direct public-network connection with the same policy as remote tool-image previews. Revisit the local patch when upgrading the Google SDK.

## Verification

- Regression — A relay-shaped response failed with `No image generated` before the patch.
- Regression — Four focused Vitest files passed 194 tests covering URL-only, inline-only and mixed Gemini responses, download error mapping, safe download delegation, and the image IPC handler.
- The tests use fixture responses. They do not exercise a live relay.
