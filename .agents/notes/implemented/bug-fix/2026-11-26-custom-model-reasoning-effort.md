# Agent Note: Reasoning effort fallback for unrecognized custom models

Status: implemented

English | [中文](2026-11-26-custom-model-reasoning-effort.zh.md)

## Problem

Manually added custom models whose IDs match no registry reasoning family received no reasoning descriptor at all, so model settings showed no Reasoning Effort control and requests carried no effort parameter — even after the user explicitly enabled the REASONING capability. Gating on `inferReasoningMembership` plus `inferReasoningControls` left only one escape hatch: a hard-coded Ollama fallback. Self-hosted or customized reasoning models on any other provider could not adjust reasoning effort.

## Decision

`inferCustomModelReasoning` synthesizes effort controls `[low, medium, high]` when the model explicitly declares the REASONING capability but matches no PROFILE rule. A PROFILE match with no knobs (e.g. `step-3`) is an intentional fixed reasoner and stays knob-less instead of falling back. Recognized family vocabularies win over the Ollama fallback on both the create and read paths. The existing wire projection still filters that ladder, so endpoints without an effort mode (or with a disabled profile) correctly resolve to no selectable efforts and the controls stay hidden. `ModelService` keeps Ollama's richer `toggle + [low, medium, high]` descriptor for truly unknown IDs on Ollama, preserving the ability to disable thinking there. The default ladder derivation stays stateless: it is derived during enrichment from the current capability (not persisted), so removing REASONING clears it, and the `CreateModelDto`/`UpdateModelDto` contract (intrinsic controls remain catalog-owned, rows carry only `defaultEffort`) is unchanged.

## Alternatives considered

- Persist user-editable controls through the model DTOs: rejected because it expands the create/update contract for a need the stateless fallback already covers, and intrinsic controls remain catalog-owned by design.
- Include a toggle (disable switch) for every format: rejected because it diverges from built-in minimal ladders such as gpt-oss and o1/o3/o4, which offer effort tiers with no disable switch.
- Custom per-model effort values or parameter names (the issue's "even better"): deferred; no UI or DTO contract exists for it yet.

## Consequences

Custom reasoning models now surface the default-effort picker in model settings, the composer effort slider, and effort encoding on requests automatically. Unknown model IDs without a declared REASONING capability remain untouched, and disabled wires still hide the controls. Known fixed reasoners (PROFILE match with no knobs, e.g. `step-3`) stay knob-less; recognized families (e.g. `deepseek-v4`) keep their native vocabulary on Ollama instead of the generic fallback. Removing REASONING clears a synthetic fallback. Ollama custom models keep their previous `none`-capable behavior.

## Verification

- Regression — `pnpm vitest run src/main/data/services/__tests__/ModelService.test.ts src/main/data/services/__tests__/ProviderRegistryService.test.ts src/main/data/services/__tests__/modelMerger.test.ts`: 192 passed, including 5 #25203 cases (unknown ID with declared reasoning falls back to `[low, medium, high]` on create and list; unknown ID without it stays `reasoning == undefined`; PROFILE-only `step-3` stays knob-less; removing REASONING clears the synthetic fallback; `deepseek-v4` on Ollama keeps its native vocabulary).
- Regression — `pnpm --filter @cherrystudio/provider-registry test`: 591 passed.
- Regression — `pnpm vitest run src/renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/__tests__/EditModelDrawer.test.tsx`: 31 passed.
- Regression — `pnpm exec tsc --noEmit`: clean.
