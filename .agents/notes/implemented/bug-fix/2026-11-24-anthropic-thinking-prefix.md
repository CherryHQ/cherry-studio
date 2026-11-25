# Agent Note: Handle Anthropic thinking prefix mismatches

Status: implemented

English | [中文](2026-11-24-anthropic-thinking-prefix.zh.md)

## Problem

Cherry Studio can change the model-facing prefix by editing or compacting history, assembling different system instructions, or changing the tool list. Anthropic can reject requests that replay thinking signed against the earlier prefix. [Issue #21990](https://github.com/CherryHQ/cherry-studio/issues/21990)

## Decision

Keep signed and redacted thinking available for replay even when its display text is empty. On first-party Claude Messages requests that replay thinking, use the SDK's native `drop_block` option for supported models in adaptive mode. The API checks the original signature. Preserve any explicit binding policy and keep the existing settings for caller-owned requests and compatible gateways. [Anthropic prefix checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks)

When in-flight compaction or sliding-window trimming replaces the prefix, omit the already-generated Anthropic thinking from the rewritten prompt, including on Anthropic Messages routes in CherryIN and AiHubMix. Keep text and tool history. New thinking can be used in successive steps over the same compacted prefix.

## Alternatives considered

- Client-side fingerprints would need to approximate provider normalization and persist additional metadata on reasoning blocks.
- Sending the beta to all compatible endpoints assumes each gateway accepts and forwards the option.
- A fully append-only conversation across system and tool changes needs its own model-facing history contract.

## Consequences

The automatic server option applies to the official Claude API in supported adaptive mode. Other requests can still encounter mismatches after history edits, model switches or changes to system instructions or tools. [Issue #21990](https://github.com/CherryHQ/cherry-studio/issues/21990)

## Verification

- Regression — The Anthropic request boundary tests use the pinned SDK serializer to check the beta header, original signed blocks, eligible modes, and exclusions for compatible or caller-owned requests.
- Regression — The same tests check that blank signed and redacted parts survive history serialization, and that a locally compacted prompt still carries text and paired tool calls and results.
- Regression — A live Electron run with AiHubMix Claude Haiku 4.5 sent two signed thinking blocks on normal continuation and zero after sliding-window trimming. Both requests kept the retained answer and returned HTTP 200.
