---
title: Nano Banana and the other Gemini image models can be chatted with
category: changed
severity: notice
introduced_in_pr: "#17383"
date: 2026-09-04
---

## What changed

`gemini-2.5-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-image` (Nano Banana 2) and their preview variants now appear in the chat and Agent model pickers, and answer with images inline in the conversation. Previously they were painting-page-only: the catalog listed them as image generation alone, so every chat picker filtered them out.

These models were always chat-shaped — one Google `generateContent` call takes a conversation and returns text and images together. The app now asks for both (`responseModalities: ['TEXT', 'IMAGE']`) whenever the selected model declares image generation, which only ever reaches the wire on Gemini endpoints.

Images generated this way are stored as files like any attachment, not inline in the message, so a topic full of them stays as cheap to load as any other.

## Why this matters to the user

Image generation in chat previously required the `generate_image` tool, which routes to whatever global painting model is configured. Picking one of these models directly gives a conversational edit loop instead — ask for a change and the model answers with a new image in the same thread. The painting page is unchanged and still offers the same models.

## What the user should do

Nothing — the models show up in the chat model picker after the provider's model list refreshes. The `generate_image` tool is still there and still independent.

## Notes for release manager

The `text-generation` capability is added in `packages/provider-registry/src/creators/google.ts`; it reaches existing installs through the runtime registry merge, so no migration and no model re-add. Other vendors' image models are unaffected — `openai-chat-completions` declares no image-generation operation, so an OpenAI image model stays out of chat.
