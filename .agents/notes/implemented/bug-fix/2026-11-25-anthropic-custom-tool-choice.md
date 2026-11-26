# Agent Note: Apply Anthropic custom tool choice per attempt

Status: implemented

English | [中文](2026-11-25-anthropic-custom-tool-choice.zh.md)

## Problem

A legacy assistant `tool_choice` string can reach Anthropic Messages as a raw JSON field, which Anthropic-compatible providers may reject. Promoting it to a turn-wide SDK option ties the conversion to the primary model. Cross-model fallback reuses that option and can lose the conversion when entering Anthropic or carry it over when leaving Anthropic.

## Decision

Consume recognized strings before capturing the raw body parameters. Attach the default to the Anthropic Messages model through AI SDK middleware. The middleware sees the tools and explicit choice for the current step, then lets the SDK serialize the resulting option.

## Alternatives considered

Converting the raw JSON in fetch would duplicate the SDK's tool handling. Passing the value through fallback call options would still require distinguishing an assistant default from a per-step choice, and the retry library does not expose a tool choice override.

## Consequences

Each Anthropic attempt applies the default only when tools are available and the caller or step supplies no choice. The local AI SDK patch preserves an omitted choice as `undefined`, allowing an explicit `auto` to take precedence. Anthropic-native object values still use body passthrough.

## Verification

- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`: captures serialized JSON for streaming, per-call and per-step overrides, requests without tools, and fallback in both directions between Anthropic Messages and OpenAI Chat Completions.
