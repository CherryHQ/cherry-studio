# Agent Note: Ollama thinking follows declared model controls

Status: implemented

English | [中文](2026-11-01-ollama-thinking-controls.zh.md)

## Problem

Ollama rejects named `think` levels that a model does not support. A model's generic thinking capability does not establish that it accepts named levels.

## Decision

- Ollama emits a named level only when the model declares an effort control, and the reasoning serializer projects it onto that model's vocabulary.
- A model declaring only a toggle receives boolean `think` values.
- When the model declares no applicable controls, the mapper omits `think`.
- Ollama's generic capability fallback declares only a toggle; inferred non-effort controls are sent through that boolean switch, not as named wire levels.

## Alternatives considered

- Keep the `high` fallback and generic inferred levels: rejected because either can send a value Ollama rejects.
- Omit reasoning for every Ollama model: rejected because it would disable the supported boolean switch.

## Consequences

- Boolean-only Ollama models retain thinking without receiving named levels.
- Models with declared effort controls continue to receive a supported level.
- Unknown reasoning controls degrade to no `think` option.

## Verification

- Regression — `pnpm test:main src/main/features/apiGateway/adapters/__tests__/providerOptionsMapper.test.ts`: boolean-only, declared-level, and unknown-capability Ollama requests.
- Regression — `pnpm test:main src/main/data/services/__tests__/ModelService.test.ts`: Ollama thinking capability does not infer effort levels.
