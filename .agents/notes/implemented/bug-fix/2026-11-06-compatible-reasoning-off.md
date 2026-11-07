# Agent Note: Compatible reasoning Off fallback

Status: implemented

English | [中文](2026-11-06-compatible-reasoning-off.zh.md)

## Problem

The global fallback advertised Off for compatible endpoints even though unknown hosts may reject the resulting reasoning effort. A host serving Qwen3.8-27B rejected `none`.

## Decision

Remove Off from the global fallback wires. Explicit endpoint and model wires remain authoritative, including contracts that support Off.

## Alternatives considered

Narrowing the canonical Qwen row would treat one host's rejection as an intrinsic model limitation without evidence and would leave unmatched aliases broken.

## Consequences

Users on fallback routes lose the UI Off option. Hosts may reason at their default, which can also increase health-check latency. Explicit custom parameters remain available and are passed through.

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/utils/__tests__/reasoningCompatibility.test.ts`: checks registry projection and SDK request serialization against a rejecting host fixture.
