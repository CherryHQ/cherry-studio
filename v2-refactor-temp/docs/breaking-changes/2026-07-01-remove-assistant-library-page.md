---
title: Assistant Library is no longer a standalone sidebar page
category: removed
severity: notice
introduced_in_pr: #16609
date: 2026-07-01
---

## What changed

The "Assistant Library" (`store`) sidebar app and its `/app/library` page are removed.
Assistants, agents, and skills are now browsed and managed inline from the assistant
and agent chat pages, so the standalone page is redundant. Prompt/quick phrase
management lives in the Quick Panel flow. The `ui.sidebar.favorites` default no
longer includes `store`.

## Why this matters to the user

Users who had "Assistant Library" in their sidebar (it was on by default) will no longer
see that entry, and navigating to `/app/library` no longer resolves to a page. The assistant,
agent, and skill catalogs are not gone — their browsing, creating, and editing now lives
directly inside the chat pages. Prompts/quick phrases continue through the Quick Panel.

## What the user should do

Nothing — automatic. Browse and manage assistants, agents, and skills from the assistant
and agent chat pages instead of the old standalone page. Manage prompts/quick phrases
from the Quick Panel.

## Notes for release manager

Complements [2026-06-19-library-deeplink-removed.md](./2026-06-19-library-deeplink-removed.md):
the deep-link contract was dropped first, and this entry removes the page and sidebar entry
entirely. The shared resource catalog components (`components/resource/catalog`) and the
`library.*` i18n namespace are retained because the chat pages reuse them.
