---
title: Assistant and agent chat layouts are separate "new/old" view settings
category: changed
severity: notice
introduced_in_pr: branch jd/resource-list-config (PR TBD)
date: 2026-06-26
---

## What changed

The single experimental `chat.resource_list.position` (`left`/`right`) preference is replaced by two independent settings under **Settings → Message Settings**:

- **Conversation view** (assistant chats) — `chat.conversation_view`
- **Work view** (agent chats) — `chat.work_view`

Each is **New view** or **Old view**:

- **New view** — the classic single sidebar (topics/sessions listed in the left sidebar).
- **Old view** — a compact assistant/agent entity rail on the left plus the topic/session list in the right panel.

Both settings default to **Old view** (the entity rail).

The legacy v1 assistant `topicPosition` is migrated into Conversation view: `right` → New view, `left` → Old view. Agent Work view has no v1 source and defaults to Old view.

## Why this matters to the user

Fresh installs — and v1 users whose `topicPosition` was the default `left` — land on the **Old view**: a compact entity rail plus a right-side topic/session panel. Users who had v1 `topicPosition = right` get the **New view** (the classic single sidebar). Agent Work view is a brand-new setting that also defaults to the Old view (rail).

The preference key also changed: the never-shipped `chat.resource_list.position` no longer exists. Anything expecting that key should read `chat.conversation_view` / `chat.work_view` instead.

## What the user should do

Nothing — automatic. Switch **Conversation view** / **Work view** in Settings → Message Settings to change layout.

## Notes for release manager

Fill in the PR number once opened. This entry supersedes the in-development `chat.resource_list.position` default of `right`; that key never shipped to a release, so only the new `new/old` framing needs translating.
