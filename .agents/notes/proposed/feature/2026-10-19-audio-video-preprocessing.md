# Agent Note: Audio and video preprocessing for Chat and Agents

Status: proposed

English | [中文](2026-10-19-audio-video-preprocessing.zh.md)

## Problem

Text-only models cannot use attached audio or video, while models and endpoints that accept those modalities should keep their native path. Issue #20749 proposed a processor-only fallback. The delivery now also needs a bounded local FFmpeg runtime, frame selection, settings, and Agent read paths; those added choices need explicit review before the stack can merge.

## Proposal

- Package checksum-verified FFmpeg and FFprobe for supported desktop platforms. Keep Linux LGPL libraries and license/source material with their runtime, and resolve the packaged files without depending on a mutable user tool installation.
- Let one main-process media service probe files, extract bounded audio chunks and representative video frames, use an already available transcription asset and a caller-selected vision model, preserve source timestamps, cache reusable analysis, and propagate cancellation. Analysis must not install speech assets.
- Persist a selectable Video Vision model; the media service applies its bounded analysis budget. Keep Chat's original attachment visible: send native audio/video only when the model and resolved endpoint accept its actual MIME, otherwise inline capped analysis text. Failed required analysis stops the turn with a settings-oriented error; a valid silent result remains a note.
- Expose full timestamped analysis through attachment-allowlisted `read_file`. Pi keeps its filesystem `read` tool and turn identity while paging media analysis and honoring Stop. Ordinary Claude Code Agents mount only the read-only `assistant-files` operation with opaque handles; save and trash remain unavailable, and live tool-disable rules revoke subsequent tool calls on the active connection.

## Alternatives considered

- Rely on native multimodal providers only: this leaves text-only models unable to answer questions about audio or video.
- Preprocess separately in Chat and each Agent runtime: this duplicates resource limits, cancellation, cache ownership, and failure behavior.
- Give ordinary Agents raw attachment paths or the full writable file server: this exposes more filesystem authority than attachment reading requires.
- Download transcription assets during analysis: this turns a user request into an unexpected installation and obscures an unavailable processor.

## Acceptance criteria

- AC1 — Packaged FFmpeg and FFprobe can probe and extract media on supported macOS, Windows, and Linux builds; Linux carries its LGPL runtime dependencies and license/source material without loading mutable user binaries. (verification: unit + packaged artifact)
- AC2 — Video analysis selects a bounded set of scene-aware, non-duplicate frames and preserves source timing when frames or audio streams are sparse. (verification: unit + packaged artifact)
- AC3 — One media service returns bounded timestamped transcription and optional vision analysis, reuses valid cached results, reports unavailable analysis accurately, and cleans up on completion, failure, or cancellation. (verification: unit + Electron)
- AC4 — A user can select and persist a Video Vision model, and subsequent analysis uses that selected model. (verification: renderer + Electron)
- AC5 — Chat accepts audio/video attachments, keeps native delivery for capable model-endpoint MIME combinations, and otherwise inlines bounded analysis; WebM and Ogg route by their actual media type, failed required analysis stops before the provider call, and the original attachment remains visible. (verification: unit + renderer + Electron)
- AC6 — Agent `read_file` pages only allowed attachments, Pi `read` pages media without changing tool identity, and a stopped or superseded turn cannot publish late analysis. (verification: unit + Electron)
- AC7 — Ordinary Claude Code Agents can read current attachment analysis through opaque handles but cannot save or trash through that mount; exact, server, wildcard, and all-MCP disabled-tool rules revoke subsequent tool calls on the active connection. (verification: unit + Electron)

## Risks

- Packaged behavior, Linux LGPL artifact provenance, and platform library loading need artifact-level checks; unit tests alone cannot establish them.
- Transcription quality depends on installed local assets, and video descriptions depend on the selected vision model. Missing capability must remain visible rather than silently inventing content.
- Large media can exhaust time or context budgets; cancellation, truncation, and real-data UI behavior need validation before release.
