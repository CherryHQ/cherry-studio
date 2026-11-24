# Agent Note: Mixed tool enums on Gemini Chat Completions

Status: implemented

English | [中文](2026-11-24-gemini-chat-tool-enums.zh.md)

## Problem

CherryIN's Chat Completions endpoint returns HTTP 400 for a Gemini tool parameter with `enum: ["auto", 1]`. Google's Chat Completions endpoint accepts the same declaration. Custom relays can differ in schema support even when they expose the same model and protocol.

## Decision

Apply the existing enum normalization to outgoing Chat Completions tool schemas when the raw model ID identifies Gemini. MCP still validates tool arguments against its original schema.

## Alternatives considered

A CherryIN-only rule would miss custom relays. Applying Gemini rules to every Chat Completions request would relax tool constraints for unrelated models.

## Consequences

Recognizable Gemini models get the same enum conversion across relays. Opaque model aliases bypass the heuristic. Normalization can relax a constraint in the outgoing declaration, particularly when a numeric branch carries its allowed values in the description.

## Verification

- Regression — `toolSchemaCompatibility.test.ts`: OpenAI-compatible and New API adapters send compatible mixed enums, preserve a valid integer enum, and leave MCP validation intact.
- Live HTTP — Gemini 4 Argon on CherryIN rejects the original enum and accepts the normalized declarations. Google's official Chat Completions endpoint accepts both.
