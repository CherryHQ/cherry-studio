# Agent Note: Ollama chat history sends tool arguments as objects

Status: implemented

English | [中文](2026-11-02-ollama-tool-call-arguments.zh.md)

## Problem

Agent history stores tool-call arguments as JSON text in the OpenAI-style message representation. `modelMessageAdapter.ts` preserves that string as the AI SDK tool-call input, and the `ollama-ai-provider-v2` serializer passed it directly into native `/api/chat` `function.arguments`, where Ollama expects an object.

## Decision

The Ollama provider patch parses string tool-call inputs before building native chat messages and passes existing object inputs through unchanged. The conversion stays at the Ollama boundary; shared history keeps its OpenAI-style representation.

## Alternatives considered

- Parse arguments in the shared history adapter: rejected because that changes the representation sent to every provider.
- Send the JSON string unchanged: rejected because native Ollama chat expects an object.

## Consequences

Valid JSON-string tool inputs reach Ollama as objects, while existing object inputs are unchanged. Invalid JSON fails during request conversion instead of being sent as a string.

## Verification

- Regression — `pnpm test:main src/main/ai/provider/custom/__tests__/boundary/ollama.chatReasoning.test.ts`: captures multi-turn tool history and asserts both string and object arguments are sent as native objects.
