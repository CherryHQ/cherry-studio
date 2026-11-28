# Agent Note: MiniCPM-OCR file processor

Status: proposed

English | [中文](2026-11-05-minicpm-ocr-file-processor.zh.md)

## Problem

File Processing currently offers local OCR (tesseract, system, local PaddleOCR, OpenVINO) and remote document services (MinerU, Doc2x, Mistral, self-hosted OpenMinerU), but no processor can call a self-hosted vision-language OCR model. MiniCPM-OCR is a 1.3B Apache-2.0 OCR model that users already serve through vLLM, SGLang, llama.cpp or Ollama with an OpenAI-compatible `/chat/completions` endpoint; Cherry Studio cannot use it for image OCR even though every existing dependency is already installed on the user's side.

The existing remote processors do not cover this shape: Mistral's processor is bound to the Mistral SDK's `ocr.process` request body, and the document processors expect task/polling protocols. Pointing either at a MiniCPM-OCR server fails on the wire contract rather than on configuration.

## Proposal

Add `minicpm` as a remote file processor with the `image_to_text` capability in the first layer.

Configuration reuses the existing capability and processor schemas: `apiHost` is the OpenAI-compatible base URL (for example `http://127.0.0.1:8000/v1`), `apiKeys` is optional because self-hosted servers often run without authentication, and `modelId` is optional with `minicpm-ocr` as the default.

The processor maps onto the existing contract: a `minicpm` preset declares the `image_to_text` capability (with `apiHost` and optional `modelId`), and a registry entry with `runtime: 'remote'` and `isSupported: () => true` routes that capability to a `mode: 'background'` handler. `prepare()` resolves `apiHost`, `modelId`, and the optional key; `execute(ctx)` performs the HTTP call with `ctx.signal`, reports coarse progress, and returns the text. Errors use the main-process i18n namespace (`t('file_processing.errors.*')`), not renderer locale strings.

For each image, the handler reads the file through the existing image preprocessing path, posts `{model, messages}` to `{apiHost}/chat/completions` with the `image_url` content part (base64 data URL) before the `text` part containing `Text Recognition:`, the order MiniCPM-OCR's own client uses, and returns `choices[0].message.content` as `{kind: 'text'}`. When the endpoint is vLLM or SGLang, the request also carries `mm_processor_kwargs` with `max_slice_nums: 9` and `downsample_mode: "4x"`; endpoints that do not accept the field omit it. The request omits `max_tokens` and relies on the server default, because the supported serving stacks disagree on the acceptable value. Markdown and line breaks are preserved because MiniCPM-OCR emits both. A `Bearer` header is sent only when a key is configured.

Failures are user-visible rather than silent: non-2xx responses, non-JSON bodies, missing `choices` or `content`, and empty text each raise an i18n error; the abort signal cancels the request and propagates. Missing `apiHost` reuses the existing capability-config errors.

`document_to_markdown` is deliberately out of scope for this layer. MiniCPM-OCR's accuracy depends on the layout detector and block-level prompts (`Text Recognition:` / `Table Recognition:` / `Formula Recognition:`); a single page-level prompt loses table structure and reading order, which would make the processor look worse than the existing document services. Delivering scanned PDFs needs either a layout-aware sidecar that returns Markdown or client-side page rendering plus per-block prompts; both introduce a new wire contract and belong in their own Spec.

The note stays `proposed`; this PR does not claim an Approval on a Spec head.

## Alternatives considered

- Reusing the `mistral` processor with a custom `apiHost` would send a Mistral SDK request body to a MiniCPM-OCR server; the SDK does not speak OpenAI chat completions, so this fails at the contract level rather than through configuration.
- Reusing the chat provider/model settings would couple File Processing to a chat model selection that is unrelated to OCR and would expose OCR-only models in chat pickers.
- Bundling the model and an inference runtime in the desktop app would add at least a gigabyte of weights and a GPU/CPU runtime while every other processor already expects a local or remote service.
- Shipping `document_to_markdown` in the same layer would either silently degrade table quality or require the sidecar contract up front, delaying an independently useful image path.

## Acceptance criteria

- AC1 — A `minicpm` preset and registry entry make the processor selectable for `image_to_text` in File Processing, the selection persists through the existing preference schema, and images routed to it reach the configured endpoint (verification: unit + renderer)
- AC2 — The request is `POST {apiHost}/chat/completions` with the configured model (default `minicpm-ocr`), the image as an `image_url` base64 data URL before the `Text Recognition:` text part, no `max_tokens` field, and `Authorization: Bearer` only when a key is configured; vLLM and SGLang endpoints additionally receive `mm_processor_kwargs` with `max_slice_nums: 9` and `downsample_mode: "4x"`, while endpoints that reject the field omit it (verification: unit)
- AC3 — `choices[0].message.content` is returned as `{kind: 'text'}` with Markdown and line breaks intact; blank or empty content raises a visible error instead of empty text (verification: unit)
- AC4 — Non-2xx responses, non-JSON bodies, missing `choices`/`content`, and network failures raise main-process i18n errors that include the HTTP status when available, and an abort cancels the request (verification: unit)
- AC5 — A missing `apiHost` surfaces the existing capability-config error, a missing API key is accepted, and a trailing slash on `apiHost` does not produce a doubled path (verification: unit)
- AC6 — Existing processors, presets, and registry contracts are unchanged, and the registry/preset consistency tests pass with the added preset and entry (verification: unit)
- AC7 — Every renderer locale carries a real processor label and description, the new error strings live under `file_processing.errors.*` in the main-process i18n resources, and the OCR settings doc shows vLLM and Ollama setup with `apiHost` including the `/v1` base while marking SGLang and llama.cpp as unverified for this layer (verification: docs gate)
- AC8 — Unit and integration tests exercise the processor against a local mock OpenAI-compatible HTTP server, including success, auth header, and failure paths (verification: unit)
- AC9 — After `ok-to-test`, an attached image is transcribed through a reachable MiniCPM-OCR endpoint on CI or a maintainer machine, and the text reaches the attachment flow end to end (verification: Electron, owner: maintainer-assisted)

## Risks

- Page-level prompts do not preserve tables or reading order; users who need scanned-document Markdown must wait for the `document_to_markdown` layer or continue using MinerU/Doc2x.
- Servers differ in whether they accept `image_url` data URLs, require `max_tokens`, or expect a different prompt. Only vLLM and Ollama are verified for this layer; SGLang and llama.cpp share the OpenAI-compatible shape but are documented as unverified, and the docs must not imply universal compatibility.
- `mm_processor_kwargs` is a vLLM/SGLang extension. Omitting it leaves slice resolution to the server default, which can lower OCR quality below the official SDK's output on dense pages.
- Images leave the app for the configured endpoint, the same privacy boundary as the existing remote processors; the docs must say so.
- Self-hosted endpoints often have no key, so the processor must not call the key-required helper; key rotation for deployments that do use keys should reuse the existing `apiKeys` behavior.
- A wrong `apiHost` (missing `/v1`, or pointing at a chat-only model) surfaces as an HTTP or decode error; the error text must identify the endpoint shape rather than only reporting a status.
