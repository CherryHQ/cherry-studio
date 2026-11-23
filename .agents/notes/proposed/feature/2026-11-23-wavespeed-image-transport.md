# Agent Note: WaveSpeed image transport for Paintings

Status: proposed

English | [中文](2026-11-23-wavespeed-image-transport.zh.md)

## Problem

WaveSpeed is registered as an OpenAI-compatible chat provider at `https://llm.wavespeed.ai/v1`, but its image models are not served on the OpenAI `/images/*` wire. They use a separate host, `https://api.wavespeed.ai`, where `POST /api/v3/<model id>` creates a prediction and `GET /api/v3/predictions/<id>/result` reports `created`, `processing`, `completed` or `failed`. Some failures arrive as HTTP 200 with a non-200 `code` in the response envelope. Without a transport, Paintings cannot use these models, and a generic retry around submission would create and bill duplicate predictions.

## Proposal

Add a `wavespeed` provider extension in `src/main/ai/provider/custom/wavespeed/` following the PPIO shape: chat and embeddings use the OpenAI-compatible SDK against the chat `baseURL`, and image generation uses a submit/poll transport whose origin defaults to `https://api.wavespeed.ai` (`imageBaseURL`), independent of the chat host. Register the preset in `IMAGE_EXTENSION_PRESETS`, the extension list and the image transport registry with polling enabled, so image jobs run through the existing image-generation job (one attempt, no job-level retry).

The registry declares WaveSpeed's served image models as provider overrides with `supplementModelsFromRegistry`, because `/v1/models` lists only chat models. Seedream 5.5 maps to the canonical `doubao-seedream-5-5` with a full `imageGeneration` block: `generate` routes to `/api/v3/bytedance/seedream-v5.5` and `edit` to `/api/v3/bytedance/seedream-v5.5/edit` (at most ten reference images). Both declare `aspectRatio` (the fifteen ratios the API accepts; generate defaults to `1:1`, edit has no default so the API derives it from the input), `imageResolution` (`1K`, `1.5K`, `2K`), `outputFormat` (`png`, `jpeg`) and `background` (`auto`, `transparent`, `opaque`). The existing Seedream 5.5 gate keeps applying because the canonical model id is the same.

The transport builds the request body from canonical values only: `prompt`, `images` (input files as data URLs, only when present), `aspect_ratio`, `resolution` (lower-cased tier), `output_format` and `background`. Unknown bag keys are dropped. It submits once and never retries submission. It polls every two seconds within a ten-minute budget, retrying transient poll failures (HTTP 5xx, 429, network errors) up to a bounded count. `completed` returns `outputs`; `failed`, `cancelled`, `timeout` and `deleted` end with the vendor `error` text. HTTP 401 maps to the token error; other HTTP 4xx and an envelope `code` other than 200 map to a remote error carrying the vendor `message`.

## Alternatives considered

- Deriving the image origin from the chat host — the hosts differ (`llm.` vs `api.`), and a user-edited chat proxy would silently redirect billed image calls; PPIO already pins its image origin the same way.
- One `generate` mode that appends `/edit` when files are attached — hides routing in code; per-mode `vendorTransport` already carries endpoints in registry data, as DashScope and AiHubMix do.
- WaveSpeed's synchronous mode — holds one request open for the whole generation; the job system already owns polling, cancellation and restart behavior.
- Uploading reference images through WaveSpeed's media upload endpoint first — adds a second request per image; the prediction endpoint accepts base64 data URLs for image inputs.
- A separate model id instead of `doubao-seedream-5-5` — would duplicate the canonical metadata and bypass the shared Seedream 5.5 validation.

## Acceptance criteria

- AC1 — The WaveSpeed provider lists Seedream 5.5 in Paintings with aspect ratio, resolution tier, output format and background controls, accepting up to ten reference images (verification: unit)
- AC2 — A generate request is posted once to `/api/v3/bytedance/seedream-v5.5` on the image origin with a Bearer key and only the mapped fields; with reference images the edit endpoint receives them as `images` (verification: unit)
- AC3 — Polling returns the output URLs on `completed`, ends with the vendor error on a terminal failure, retries transient poll failures, and never repeats the submit request (verification: unit)
- AC4 — HTTP 401 surfaces the token error, and other HTTP 4xx responses and non-200 envelope codes surface a remote error with the vendor message (verification: unit)
- AC5 — Chat requests keep the chat host while image requests use the image origin (verification: unit)
- AC6 — A desktop session generates a Seedream 5.5 image from a prompt and an edited image from a reference image (verification: Electron)

## Risks

The WaveSpeed contract is externally owned; endpoint paths, status values and model parameters must be rechecked before publication. Each submit is billed, so any future retry around submission is a regression. The edit path depends on the API accepting data URLs for `images`; if it stops doing so, inputs must be uploaded first. More WaveSpeed models can be added as registry overrides only when their parameters fit the transport's field mapping.
