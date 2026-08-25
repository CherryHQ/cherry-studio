---
title: Prompt management moved to Settings
category: moved
severity: notice
introduced_in_pr: "#18378"
date: 2026-08-11
---

## What changed

Prompt management now lives under Settings → Tools, directly below Skills. Prompts also have an
explicit visibility mode: global prompts are available in every context, while restricted prompts
are available only in the Assistants or Agents they are linked to.

## Why this matters to the user

The composer no longer opens a separate prompt-management dialog. Its management action opens the
settings page, while Assistant and Agent edit dialogs manage restricted prompt links and their order.

## What the user should do

Use Settings → Tools → Prompts to create, edit, delete, reorder, or change prompt visibility.
Use an Assistant or Agent's Prompts tab to link and order restricted prompts. A restricted prompt
with no links remains in Prompts but does not appear in chat.

## Notes for release manager

Changing a restricted prompt to global removes its restricted links because the prompt becomes
available everywhere automatically. Editing or deleting a restricted prompt affects every context
that shares it; deletion shows the affected scope before confirmation.
