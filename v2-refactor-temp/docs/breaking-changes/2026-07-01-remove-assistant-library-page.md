---
title: Assistant Library is no longer a standalone sidebar page
category: removed
severity: notice
introduced_in_pr: #16609
date: 2026-07-01
---

## What changed

The "Assistant Library" (`store`) sidebar app and its `/app/library` page are removed.
Its catalog — assistants, agents, skills, and prompts — is now browsed and managed
inline from the assistant and agent chat pages, so the standalone page is redundant.
The `ui.sidebar.favorites` default no longer includes `store`.

## Why this matters to the user

Users who had "Assistant Library" in their sidebar (it was on by default) will no longer
see that entry, and navigating to `/app/library` no longer resolves to a page. The catalog
itself is not gone — the same assistant/agent/skill/prompt browsing, creating, and editing
now lives directly inside the chat pages.

## What the user should do

Nothing — automatic. Browse and manage the library from the assistant and agent chat
pages instead of the old standalone page.

## Notes for release manager

Complements [2026-06-19-library-deeplink-removed.md](./2026-06-19-library-deeplink-removed.md):
the deep-link contract was dropped first, and this entry removes the page and sidebar entry
entirely. The shared resource catalog components (`components/resource/catalog`) and the
`library.*` i18n namespace are retained because the chat pages reuse them.
