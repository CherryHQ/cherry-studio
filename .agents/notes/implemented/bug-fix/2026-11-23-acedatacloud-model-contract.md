# Agent Note: Ace Data Cloud model contracts

Status: implemented

English | [中文](2026-11-23-acedatacloud-model-contract.zh.md)

## Problem

The Ace Data Cloud preset used an OpenAI-only service path. Its generic model list mixed chat and media IDs and did not declare each model's protocol. Matching those IDs to another provider's catalog could also supply unrelated prices, limits and tool capabilities.

## Decision

Use the existing provider-owned model resolution and endpoint types. Intersect the authenticated gateway IDs with the public typed chat catalog, preserve image-capable chat models, and select their published Chat Completions, Responses or Messages endpoint. The Messages transport converts the selected SDK credential to Bearer authentication while preserving the existing fetch transport and request body. Custom hosts retain their configured behavior.

Represent tool support separately as optional `parameterSupport.tools.supported`: `null` is unknown, a boolean is explicit, and an absent field retains existing behavior. Store it in the existing parameters JSON. Automatic import keeps known vision and reasoning metadata together with unknown tool support. A user capability edit writes an explicit boolean. Only the tool-attempt gate accepts unknown; verified capability presentation still reads the capability list.

## Alternatives considered

- Copy a vendor catalog or add every gateway ID to Chat Completions: rejected because names do not establish API compatibility or prices.
- Treat missing tool metadata as false or advertise every model as supporting tools: rejected because either blocks existing user attempts or claims unverified support.
- Add database columns or a separate model catalog: unnecessary; existing JSON metadata and the public catalog supply the required state.

## Consequences

No tables or migrations are added. Support metadata never becomes the outgoing `tools` array. Existing explicit capability overrides remain effective. New official model IDs can appear on the next model refresh without a code release. This integration requires the public catalog to publish endpoint metadata; failed metadata validation preserves the existing error/retry flow.

## Verification

- Regression — Main provider tests exercise typed discovery, native Messages Bearer authentication, caller tools and request-body isolation; the real SQLite test covers stored unknown support, retained vision/reasoning and explicit user enable/disable.
- Regression — Renderer import and shared capability tests cover the fetched-model to create-DTO boundary and keep unknown support out of verified badges.
- Regression — Provider-registry tests cover catalog invariants, endpoint contracts and forward compatibility. Native paid inference and a packaged application UI run were not performed.
