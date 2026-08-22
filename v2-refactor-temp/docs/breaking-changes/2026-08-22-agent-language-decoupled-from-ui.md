---
title: Agent reply language decoupled from UI language
category: changed
severity: breaking
introduced_in_pr: #19160
date: 2026-08-22
---

## What changed

Agent reply language is now controlled by a dedicated preference `agent.language` (global) and per-agent `configuration.language`, instead of inheriting the UI language (`app.language`). The default for both is `auto`, which means no language constraint is injected into the system prompt.

## Why this matters to the user

Before this PR, every agent turn injected `IMPORTANT: You must respond in <UI language>` — the UI language directly dictated reply language. After the upgrade, an existing setup with e.g. Chinese UI and no persona language will no longer get a Chinese reply by default; the model will reply in its own default (often English). The behavior is intentional to let `SOUL.md` / `agent.instructions` dictate language without being overridden, but it is a silent behavior change on upgrade. Neither the global preference nor the per-agent override is currently exposed in the settings UI — they are only configurable by editing the Electron store / agent JSON.

## What the user should do

If you relied on the implicit "reply in my UI language" behavior, set `agent.language` to your UI language (or set the per-agent `configuration.language` for individual agents) via the config store until a UI picker is added. To let the persona decide, leave both on `auto`.

## Notes for release manager

Two-level design was requested in review; the gap is the silent default flip (`auto` vs previous UI language) and the missing UI. Follow-up should surface at least the global `agent.language` picker (and per-agent override in `AgentEditDialog`) so users can restore the old behavior without editing JSON. Consider migrating existing installs' `agent.language` to the current `app.language` on first run if we want to preserve backward compatibility.
