---
title: New agents default to bypass-permissions and soul mode
category: changed
severity: notice
introduced_in_pr: #16187
date: 2026-06-18
---

## What changed

Creating an agent from the v2 library now defaults its `permission_mode` to
`bypassPermissions` and `soul_enabled` to `true`. Previously the create flow left
both unset and let the backend default apply (which only enabled them when the
user opted in).

## Why this matters to the user

A newly-created agent will, by default, **not** prompt for tool-use approval
(it bypasses permission requests) and runs with soul mode on. This is a more
permissive default security posture than before.

## What the user should do

The defaults are editable immediately after creation in the agent edit dialog —
change `permission_mode` there if you want approval prompts, or turn soul mode off.

## Notes for release manager

- Security-relevant default change; consider calling it out explicitly in the
  release note. Set at `pages/library/LibraryPage.tsx` create handler.
- Inherited verbatim from `feat/chat-page` (`5383513090 feat(agent): enhance agent
  configuration with permission mode and soul mode options`).
