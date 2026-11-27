# Agent Note: Fortytwo built-in provider

Status: proposed

English | [中文](2026-11-05-fortytwo-built-in-provider.zh.md)

## Problem

Fortytwo users currently need a custom OpenAI-compatible connection. A bundled provider should expose the served model with correct capabilities, pricing and attribution through ordinary chat and Pi Agent requests.

## Proposal

Add a global-edition-only Fortytwo preset using OpenAI-compatible Chat Completions at https://api.fortytwo.network/v1. Map qwen/qwen3.8-27b to the existing canonical model, with provider-owned limits and rates. Support text/image input, tools, strict structured output and reasoning_effort values `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. Preserve explicit `none` and `medium`; omit an unset effort so the API default remains `medium`. Preserve custom-provider privacy and explicit caller-header precedence.

Add a source-only provider selection to the catalogue generator so this explicit provider can be regenerated without fetching or rewriting unrelated model and provider records. Reuse the existing credential-free app-header helper in Pi model injection; preserve key routing, gateway/session policies and literal-header escaping. Include official light/dark icons and existing locale labels. No new runtime, storage schema, general authentication redesign, backend logging change or China-edition availability claim is proposed.

The model currently advertises 262144 context and 235929 maximum output tokens; per-million-token rates are USD0.425 input, USD0.085 cached input and USD2.55 output. Current pricing documentation states that cache writes are free, so this proposal uses an explicit provider-specific zero cache-write rate rather than inheriting a canonical rate. This revises the earlier prototype's unknown/null cache-write treatment and needs approval as part of this Spec; no existing implementation was silently changed. Sources: [model contract](https://docs.fortytwo.network/docs/models) and [pricing](https://docs.fortytwo.network/docs/pricing). Recheck these externally owned facts when implementing and before publication.

## Alternatives considered

Custom connections already work but do not provide a discoverable bundled preset. A full catalogue refresh can introduce unrelated remote drift. A Fortytwo-only hardcoded Pi header branch would duplicate the existing built-in/custom policy. Changing the shared canonical model would incorrectly attribute this provider's tariffs or capabilities to other providers.

## Acceptance criteria

- AC1 — The global edition lists Fortytwo with the production endpoint and exactly the served model; other editions and providers retain their existing behaviour (verification: unit)
- AC2 — Resolved metadata preserves provider limits, exact known rates including documented zero cache-write cost and supported input/output/reasoning capabilities without modifying the canonical model (verification: unit)
- AC3 — The selected-provider generation mode is deterministic, rejects incompatible or unknown selections and preserves canonical and sibling-provider data without remote enrichment (verification: unit)
- AC4 — Ordinary and Pi requests carry Cherry attribution headers for built-in providers, honour caller overrides and retain custom-provider privacy, credentials, gateway/session and escaping contracts (verification: unit)
- AC5 — Official light/dark icons, locale labels and generated consumers remain consistent (verification: renderer)
- AC6 — A real isolated desktop session demonstrates streamed chat/reasoning, an image answer and a Pi tool call/result with outgoing attribution evidence (verification: Electron)
- AC7 — Required affected checks pass on the implementation base, evidence excludes credentials, temporary test resources are cleaned up and no backend-log or released-build success is inferred (verification: packaged artifact)

## Risks

The catalogue and Pi runtime evolve quickly; an older prototype and its checks are not evidence for a rebased implementation. Existing research covered desktop behaviour, but implementation acceptance must identify its exact source revision. Pi header reuse affects all built-in Pi providers, so custom/gateway/session regressions are required. The source-only generator is shared tooling and needs independent review. Upstream approval of this exact Spec head precedes an implementation PR; this proposed note does not claim that approval or waive signed-commit requirements.
