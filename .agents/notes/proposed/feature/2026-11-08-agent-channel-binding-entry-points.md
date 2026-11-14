# Agent Note: Agent-scoped IM channel binding entry points

Status: proposed

English | [中文](2026-11-08-agent-channel-binding-entry-points.zh.md)

## Problem

IM channel binding lives only under global Settings > Channels. The entry is several levels deep and not tied to any Agent, so users who want to talk to a given Agent over WeChat or Feishu cannot find where to bind it. A prior fix (#15624) had Agents verbally direct users to the page, which is a workaround, not a discoverable entry point (#15956).

Channels already store their Agent as `agentId`, so the binding model needs no change. The gap is the entry points.

## Proposal

Add two shallower entry points that reuse the existing `agentId` binding. The global Settings > Channels entry stays.

- **Agent list menu.** Each Agent's menu gains "Connect to IM…", which opens the Agent's settings dialog with the Channels tab active.
- **Agent settings dialog.** A Channels tab, also reachable directly, lists the supported IM channels (WeChat, Feishu, Telegram, QQ, Discord, Slack, and the other available types). Switching a channel on binds it to this Agent; switching it off clears this Agent's binding for that type.

Binding rules:

- Turning a channel on reuses an existing unbound channel of that type when one exists, otherwise it creates one with the type's default configuration. Feishu and WeChat are created active, since they register by QR code; other types are created inactive until credentials are entered.
- A bound channel that is not yet active shows a hint with a link to Channel settings. Activating it stays in Settings.
- Bindings are scoped to the Agent. An Agent with no bound channel behaves as today; nothing is forced.

## Alternatives considered

- **Deep link into global Settings only.** Status quo; declined by the issue as too hidden.
- **Bind from the Channel settings page only, plus a "Connect" button on the Agent card.** Rejected: the Agent settings dialog is where users already configure an Agent, and the issue asks for it there.
- **Auto-activate existing channels on bind.** Declined: credential-gated channels would fail activation validation. The tab shows a hint instead.

## Acceptance criteria

- AC1 — The Agent list menu for each Agent shows a "Connect to IM…" item. (verification: renderer test)
- AC2 — Selecting that item opens the Agent settings dialog with the Channels tab selected, not the default tab. (verification: renderer test)
- AC3 — The Channels tab is present in the Agent settings dialog when opened directly, and shows the Agent's current bindings. (verification: renderer test)
- AC4 — Turning a supported channel on in the Channels tab binds it to that Agent, and the binding persists across reloads. (verification: renderer test, Electron)
- AC5 — Turning a channel off unbinds it from that Agent, and the Agent no longer receives messages from that channel. (verification: main service test, Electron)
- AC6 — An Agent with no bound channel works normally in the in-app conversation. (verification: existing Agent suites)
- AC7 — The global Settings > Channels entry is unchanged. (verification: renderer test)
- AC8 — New labels are translated in every shipped locale, and the i18n gate passes. (verification: i18n gate)

## Risks

- Creating a channel from the Agent dialog depends on the same creation path as the Settings page, so the two can drift. Keep one code path.
- Credential-gated channels created from the tab stay inactive until configured. Users may read the switch as "connected"; the inactive hint is the mitigation.
- The resource-catalog grid has its own Agent menu. It is out of scope here and needs its own AC if wanted.
- Written after the implementation draft, not before. The implementation PR must not be marked ready until this Spec is approved on its current head.
- Partially superseded by [Paged edit dialog for Agents and Assistants](2026-11-12-resource-edit-pages.md): the Agent's Channels page becomes a list of bound channels with full configuration instead of one toggle per platform. The Agent list menu entry and the unchanged global Settings > Channels stay.
