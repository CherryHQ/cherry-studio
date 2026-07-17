---
title: Custom CSS is isolated to each app window by default
category: changed
severity: breaking
introduced_in_pr: "#17139"
date: 2026-07-16
---

## What changed

Custom CSS is now scoped to Cherry Studio's public `data-ui` app boundary by default. Every app-owned DOM node also gains
a stable semantic selector for advanced themes, tests, and automation. Existing component structure markers move from
`data-slot="dialog-content"` to `part:dialog-content` tokens in that same `data-ui` attribute.

## Why this matters to the user

Existing custom CSS continues to override elements inside the current Cherry Studio window, but selectors that target the
boundary element itself should use `:scope`. Selectors that depend on `[data-slot]` must be migrated, and stylesheets using
`@import` or `@charset` must explicitly opt into raw mode.

## What the user should do

Prefer semantic selectors such as `[data-ui~='chat.message']`. Replace selectors such as
`[data-slot='dialog-content']` with `[data-ui~='part:dialog-content']`. Add `/* @cherry-ui raw */` to the stylesheet only
when global behavior or `@import` is intentional. Raw mode retains the previous unscoped behavior.

## Notes for release manager

Link the UI Semantic Contract reference in theme-author documentation.
