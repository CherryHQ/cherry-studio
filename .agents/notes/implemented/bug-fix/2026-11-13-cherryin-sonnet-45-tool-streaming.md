# Agent Note: CherryIN Sonnet 4.5 tool streaming

Status: implemented

English | [中文](2026-11-13-cherryin-sonnet-45-tool-streaming.zh.md)

## Problem

CherryIN's Bedrock route for Claude Sonnet 4.5 rejects tool definitions containing `eager_input_streaming` with HTTP 400. The Anthropic SDK emits the field by default on streaming requests and also honors explicit per-tool opt-ins.

## Decision

The CherryIN Anthropic adapter disables eager input streaming for Sonnet 4.5 at both levels. It retains the tool schema and uses the same normalization for streaming and non-streaming calls.

## Alternatives considered

Stripping the field at the internal gateway ingress leaves the outbound SDK free to add it again. Disabling it for every CherryIN model would also change the behavior of models whose upstream accepts the field.

## Consequences

Sonnet 4.5 on CherryIN uses buffered tool input. Other CherryIN models and other providers retain their own streaming behavior.

## Verification

- Regression — `cherryin-provider.test.ts`: checks the outbound field for default and explicit opt-ins on Sonnet 4.5, preserves the tool schema, and checks that Sonnet 4.6 still sends the field.
- Regression — Windows desktop Work session: a real CherryIN Sonnet 4.5 request completes in a Pi Durable session without the observed validation error.
