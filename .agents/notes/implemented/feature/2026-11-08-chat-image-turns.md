# Agent Note: Image generation turns in chat

Status: implemented

English | [中文](2026-11-08-chat-image-turns.zh.md)

## Problem

Cherry Studio V1.9.13 allowed users to select image models in ordinary chat and continue from a generated image. V2 removed that interaction even though its chat transport, file parts, branching and persistence already represent images. Users therefore cannot request, revise and branch image work in the same conversation, while dedicated image models remain confined to a separate workflow.

## Decision

Expose every enabled image-generation model in chat and in the assistant model pickers. Models with a chat protocol use the existing conversation protocol and publish native file parts. Dedicated image APIs remain on image transport even when catalog metadata incorrectly lists text output. Dedicated image models run a narrow chat image turn around the existing image-generation service instead of introducing a second chat stack.

A model that a provider publishes in both its chat and its image catalog keeps both endpoints declared, so chat uses the chat protocol and the image workflow uses the image endpoint; the shared predicate then classifies it as chat-capable rather than image-only.

For each dedicated image turn, use the latest user message's non-empty text as the prompt when the selected mode requires one. Images attached to that message are references: they request `edit` when the model declares that mode, and `generate` for a model that declares only `generate` — some registries (seedream, hunyuan-image, vidu) accept reference images on their generation mode and declare no edit mode. A model that declares neither mode reports a capability error for them. When the message has no attached image, inherit the newest assistant image on the active branch only if editing is supported. Generate-only models start a new generation on later text-only turns. A model that supports different limits uses its registry-declared modes and that mode's maximum input images. The active branch is the only source of automatic edit references, so switching branches cannot silently edit an image from a sibling branch.

Resolve provider endpoints by intent. Chat intent selects the first declared chat protocol without reordering New API text protocols by model name. Image intent prefers an endpoint that declares image generation for dedicated image transport. OpenRouter image-chat requests request both text and image modalities. New API OpenAI-compatible chat responses are normalized at the adapter boundary: data-image Markdown becomes an OpenAI-compatible `images` entry for both JSON and SSE responses, reassembled across transport chunks and SSE content deltas. OpenRouter and OpenAI-compatible SDK adapters replay generated assistant images as user image inputs before the next instruction, preserving assistant text and reasoning.

Persist native inline image outputs through FileManager before the message is finalized, then reference the resulting files from the saved message. Temporary chats retain automatic files until deletion or successful promotion; promotion registers persistent message-file references before releasing retention. Image invocations retain the originating chat message and source for usage accounting. Preserve the current turn's normal abort behavior and report a failed or empty image turn as an error rather than a successful blank assistant message.

Persistent chats reuse existing multi-model parallel execution; temporary chats still use only their first model. Dedicated image APIs receive the current user prompt and selected image references, not the full text history or system prompt. Per-turn image parameter controls and a separate chat UI remain outside this change.

## Alternatives considered

- Restoring v1's image model path wholesale would duplicate message, persistence and stream ownership that V2 now centralizes.
- Keeping only Gemini and OpenRouter image-chat models would leave OpenAI Images, Flux, Seedream and similar dedicated models unavailable from chat.
- Reproducing the remaining chat loop inside an image-only adapter would make cancellation, branching and persistence disagree with normal chat turns.
- Treating New API Markdown as display-only would produce visible base64 text and leave later chat turns without a file reference.
- Automatically selecting the nearest assistant image across all branches would make branch switches mutate the wrong context.

## Consequences

The image turn reuses `generateImage` and the existing `messages` stream source, so cancellation, persistence, projection and usage accounting stay on the normal chat path. Chat-started image requests never pass the `ai.image.generate` IPC boundary, so they carry registry defaults rather than user-edited parameters. Generated files use `delete_when_unreferenced`: persistent chats own them through `chat_message_file_ref`, while temporary chats synchronously close the topic and release runtime retention on deletion. The existing FileManager GC then reclaims unreferenced images; deletion does not promise immediate disk erasure. A model whose catalog entry lists a text output but serves only `/images` must be corrected in the registry creator; the shared predicate does not special-case model ids.

Provider catalogs can advertise an image capability while exposing only generate or only edit; the UI must let users choose the model, and the image turn reports a clear capability error when the requested action is unsupported. New API relays may change how they encode images, so normalization is limited to data-image Markdown and leaves ordinary links and other response protocols untouched. Structured image parameters remain at registry defaults in this iteration; users who need non-default settings still use the dedicated image workflow.

Image-only classification now drives two different pickers. The chat composer and the message regenerate picker accept dedicated image models; text task settings (default model, quick assistant, translate, context compression, the API gateway) keep excluding dedicated image APIs. Text-output image models such as Gemini image-chat models remain ordinary chat models and stay eligible there, which is intended: they can answer text.

## Verification

- AC1 — Every enabled image-generation model remains discoverable in the chat model selectors, while embedding, rerank and other non-chat models remain excluded. `src/shared/utils/__tests__/model.test.ts` covers the predicate combinations; `ChatComposer.test.tsx` and `homeMessageListAdapter.test.tsx` cover the selectors.
- AC2 — Text-and-image chat models use their chat protocol with native image output enabled. `capabilities.test.ts` covers the enablement gate; `config.test.ts` covers OpenRouter `modalities`; `options.test.ts` covers the OpenAI-family branches.
- AC3 — Dedicated image models choose generate or edit from the registry and continue only from the newest assistant image on the active branch. `imageTurn.test.ts` covers prompt, edit references, generate-mode references, branch selection and prompt-free modes; `AiService.test.ts` covers the routing and file output.
- AC4 — Chat and image intents resolve the correct provider endpoint across native Gemini, New API, OpenRouter and standard image providers without changing the wire model id. `endpoint.test.ts` and `imageGenerationJobHandler.test.ts` cover the resolution.
- AC5 — New API JSON and SSE chat responses convert Markdown data images into SDK file parts. `newApiDataImage.test.ts` covers normalization; `imageChatHistory.test.ts` checks the next wire request for both text-and-image and image-only replies.
- AC6 — Inline generated images become managed files with stable references in both persistent and temporary chats, and deleting a temporary chat releases them for existing GC. `relocateInlineImages.test.ts`, `TemporaryChatService.test.ts` and `FileManager.retention.test.ts` cover persistence, promotion and deletion.
- AC7 — Stopping an image turn cancels provider work without an error, and a response with no image produces a terminal stream error. `AiService.test.ts` covers both paths.
