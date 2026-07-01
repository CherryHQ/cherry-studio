---
title: Assistant and agent chat layouts are separate "classic/modern" layout settings
category: changed
severity: notice
introduced_in_pr: #16434
date: 2026-06-26
---

## What changed

The single experimental `chat.resource_list.position` (`left`/`right`) preference is replaced by two independent settings under **Settings → Message Settings**:

- **Conversation view** (assistant chats) — `topic.layout`
- **Work view** (agent chats) — `agent.layout`

Each is **Modern layout** or **Classic layout**:

- **Modern layout** — the single sidebar (topics/sessions listed in the left sidebar).
- **Classic layout** — a compact assistant/agent entity rail on the left plus the topic/session list in the right panel.

Both settings default to **Classic layout** (the entity rail).

The legacy v1 assistant `topicPosition` is deleted during v2 classification and is not migrated into either setting. Both new settings default to Classic layout.

## Why this matters to the user

Fresh installs and migrated users land on the **Classic layout**: a compact entity rail plus a right-side topic/session panel. Users can switch **Conversation view** or **Work view** to **Modern layout** for the single sidebar.

The preference key also changed: the never-shipped `chat.resource_list.position` no longer exists. Anything expecting that key should read `topic.layout` / `agent.layout` instead.

## What the user should do

Nothing — automatic. Switch **Conversation view** / **Work view** in Settings → Message Settings to change layout.

## Also changed: agent session options menu

The agent session options menu drops its "toggle sidebar" item. This is an alpha behavior change, not data-affecting — documented here for completeness.

## Also changed: default sidebar grouping mode

This PR also changes the **default grouping** of the single-sidebar (Modern layout) lists — an intentional product decision, independent of the layout split:

- `topic.tab.display_mode`: `assistant` → `time`
- `agent.session.display_mode`: `agent` → `workdir`

Neither key has a v1 migration mapping, so the new default applies to fresh installs **and** users migrating from v1. This is **not** a breaking change — the feature is still in alpha, and existing stored grouping values still render. The current UI does not expose a full display-mode switcher, though: conversation topics have no display-mode menu in the single sidebar, and agent sessions expose only **Time** / **Workdir** choices. Documented here only for completeness.

## Notes for release manager

This entry supersedes the in-development `chat.resource_list.position` default of `right`; that key never shipped to a release, so only the new `classic/modern` framing needs translating.
