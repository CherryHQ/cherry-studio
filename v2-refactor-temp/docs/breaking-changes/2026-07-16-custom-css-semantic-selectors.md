---
title: Custom CSS gains stable semantic selectors in every window
category: changed
severity: breaking
introduced_in_pr: "#17139"
date: 2026-07-16
---

## What changed

Every app-owned DOM node now gains a stable semantic selector for advanced themes, tests, and automation. Custom CSS is
injected verbatim into every regular renderer window, including the selection toolbar. Renderer-owned component
structure markers move from `data-slot="dialog-content"` to `part:dialog-content` tokens in that same `data-ui`
attribute. Shadcn-derived UI-library nodes may still carry private `data-slot` markers, mirrored into the same public
`part:*` contract.

## Why this matters to the user

Existing custom CSS keeps its full behavior, including `:root`, `body`, and top-level at-rules, and now applies
consistently to all regular windows. Selectors that depend on `[data-slot]` must be migrated because any remaining
library markers are implementation details, not the application contract.

## What the user should do

Prefer semantic selectors such as `[data-ui~='chat.message']`. Replace selectors such as
`[data-slot='dialog-content']` with `[data-ui~='part:dialog-content']`. Use a selector such as
`[data-ui~='scope:window:main']` only when a rule should target one window type.

## Notes for release manager

Link the UI Semantic Contract reference in theme-author documentation.
