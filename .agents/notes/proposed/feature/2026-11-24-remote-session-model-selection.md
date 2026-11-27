# Agent Note: Choose a desktop model when starting a remote conversation

Status: proposed

English | [中文](2026-11-24-remote-session-model-selection.zh.md)

## Problem

Desktop lets each interactive Session use its own model. A paired phone can see the Agent's default model but cannot discover the models it could select on that computer or supply a selection when creating a Session.

## Proposal

Advertise optional model selection for new remote Sessions. Under the existing Agent grant, let the phone page through models selectable by the chosen Agent on that desktop. The desktop owns provider availability, runtime compatibility and Cherry Cloud access. Return provider and model identities and display names. The phone opens its picker from the draft composer, groups by provider, and offers the Agent default.

An explicit selection travels with `agent.sessions.create`. Validate it against the desktop catalog at creation and save it with the Session in the existing transaction. Omission means the Session follows the Agent default. The phone records the selection with its pending create command for reconnects. The existing [Session model ownership decision](../../implemented/bug-fix/2026-11-14-agent-session-model-ownership.md) governs execution.

## Alternatives considered

Exporting provider configuration would require a different grant and would give the phone responsibility for desktop filtering. Sending a model with every message would give the two clients different views of the same Session.

## Acceptance criteria

- AC1 — A paired phone can browse the selected Agent's selectable desktop models grouped by provider, including identically named models from different providers (verification: unit and mobile)
- AC2 — Choosing a model for a new conversation uses it from the first turn and persists it for subsequent turns on either device; sibling Sessions and scheduled tasks retain their own model rules (verification: unit)
- AC3 — Following the Agent default leaves the Session override empty. An older desktop continues to support ordinary remote creation without showing a model picker (verification: unit and mobile)
- AC4 — A selection that becomes unavailable before creation is rejected with the draft recoverable. Reconnecting with a pending creation preserves its selected model and command identity (verification: unit and mobile)

## Risks

Catalog visibility can change between browsing and sending, especially after a desktop account or entitlement change. Creation must check the current selection before writing the Session. The mobile package consumes the shared wire schemas, so its update must be coordinated with the protocol package release.
