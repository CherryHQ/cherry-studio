---
title: Custom CSS gains stable semantic selectors in every window
category: changed
severity: notice
introduced_in_pr: "#17139"
date: 2026-07-16
---

## What changed

Every app-owned DOM node now gains a stable semantic selector for advanced themes, tests, and automation. Custom CSS is
injected verbatim into every regular renderer window, including the selection toolbar. Existing static
`data-slot="dialog-content"` structure markers remain unchanged and are mirrored to `part:dialog-content` tokens in the
new `data-ui` contract.

## Why this matters to the user

Existing custom CSS keeps its full behavior, including `:root`, `body`, and top-level at-rules, and now applies
consistently to all regular windows. Existing selectors that depend on `[data-slot]` continue to work, while `data-ui`
provides a maintained semantic surface for new selectors.

## What the user should do

No migration is required. Prefer semantic selectors such as `[data-ui~='chat.message']` or
`[data-ui~='part:dialog-content']` for new themes. Use `[data-ui~='scope:window:main']` only when a rule should target one
window type.

## Notes for release manager

Link the UI Semantic Contract reference in theme-author documentation.
