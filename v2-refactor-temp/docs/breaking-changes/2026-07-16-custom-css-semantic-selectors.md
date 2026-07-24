---
title: Custom CSS gains stable semantic selectors in every window
category: changed
severity: notice
introduced_in_pr: "#17139"
date: 2026-07-16
---

## What changed

App-owned component boundaries now gain semantic selectors for advanced themes, tests, and automation. Ordinary nested
HTML remains addressable below its nearest component selector without receiving a separate generated token. Custom CSS
is injected verbatim into every regular renderer window, including the selection toolbar. Existing static
`data-slot="dialog-content"` structure markers remain unchanged and contribute `part:dialog-content` to the unified
`data-ui` semantic layer. Application and vendor stylesheets now live in cascade layers while custom CSS stays
unlayered, so custom CSS overrides application styling regardless of selector specificity or page load order—no
`!important` needed (and `!important` should be avoided: layered application `!important` rules outrank unlayered
ones).

## Why this matters to the user

Existing custom CSS keeps its full behavior, including `:root`, `body`, and top-level at-rules, and now applies
consistently to all regular windows. Existing selectors that depend on `[data-slot]` continue to work, while `data-ui`
provides a maintained semantic surface for new selectors.

## What the user should do

No migration is required. Prefer semantic selectors such as `[data-ui~='app.sidebar']`,
`[data-ui~='chat.message']`, or `[data-ui~='settings.content']`, and structural selectors such as
`[data-ui~='part:message-content']` or `[data-ui~='part:dialog-content']` for new themes.

## Notes for release manager

Link the UI Semantic Contract reference in theme-author documentation.
