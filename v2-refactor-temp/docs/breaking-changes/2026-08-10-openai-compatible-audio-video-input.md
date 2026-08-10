---
title: Video and more audio formats now reach OpenAI-compatible models
category: changed
severity: notice
introduced_in_pr: '#18316'
date: 2026-08-10
---

## What changed

Attached video now actually reaches video-capable models served over the OpenAI-compatible
API (Kimi, Qwen, MiniMax, doubao, vLLM, most aggregators) — it is sent as a `video_url`
content part instead of being replaced with a "this model can't process the attached video
file" note. Audio attachments in ogg / flac / aac are sent too, where they previously failed
the whole request. BigModel (Zhipu) is excluded: its API takes a public video URL only, so
local video files there still fall back to the note.

## Why this matters to the user

Attaching an `.mp4` to a video-capable model was already possible in the composer, but the
model never saw it and answered from the prompt alone. It now sees the video. Two knock-on
effects: requests get much larger (the file is inlined, so a 40 MB clip is ~53 MB on the
wire), and if a provider tags a model as video-capable without actually accepting video, the
request now returns a provider error instead of silently degrading. Un-checking the model's
"video" capability tag in provider settings restores the old behavior.

## What the user should do

Nothing — automatic.

## Notes for release manager

Video capability comes from the model registry (`inputModalities` including `video`) and is
user-editable per model. Provider-side size limits still apply and are not enforced client
side: MiniMax caps the request body at 64 MB, Kimi and Qwen accept base64 data URLs, BigModel
does not.

Container support is also unenforced. Cherry accepts mp4, avi, mov, wmv, flv and mkv, while
vendors document a much shorter list (BigModel: mp4/mkv/mov; MiniMax: mp4/avi/mov/mkv) — an
`.mkv` or `.avi` that used to produce a graceful note can now come back as a provider error.
A per-container allowlist would have to live in attachment routing, since `NativeFileSupport`
is per-modality booleans; worth a follow-up if it generates reports.
