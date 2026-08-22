---
title: Agent reply language decoupled from UI language
category: changed
severity: breaking
introduced_in_pr: #19160
date: 2026-08-22
---

## What changed

Agent reply language is now controlled by a dedicated preference `agent.language` (global) and per-agent `configuration.language`, decoupled from the UI language (`app.language`). When neither is set (default `auto`), the runtime falls back to the UI language (`app.language`) so existing installs keep replying in their UI language. An explicit per-agent `auto` suppresses the instruction entirely (opt-out).

## Why this matters to the user

Before this PR, every agent turn injected `IMPORTANT: You must respond in <UI language>`. After the PR the same turn injects `By default, respond in <effective language>. If the Agent System Prompt, Workspace Instructions, or Agent Persona (SOUL.md) specifies a different language, follow that instruction instead.` — the wording is deferential and positioned before persona/workspace content so `SOUL.md` / `agent.instructions` can override it, while the fallback preserves "reply in my UI language" for users with no persona directive on upgrade. Neither the global preference nor the per-agent override is currently exposed in the settings UI — they are only configurable by editing the Electron store / agent JSON.

## What the user should do

No action is required to keep the previous behavior — `auto` (the default) now resolves to your UI language. To decouple reply language from the UI, set `agent.language` to an explicit language or `auto` at the per-agent level to suppress the instruction. A UI picker is planned as a follow-up.

## Notes for release manager

Two-level design was requested in review; the gap is the silent default flip (`auto` vs previous UI language) and the missing UI. Follow-up should surface at least the global `agent.language` picker (and per-agent override in `AgentEditDialog`) so users can restore the old behavior without editing JSON. Consider migrating existing installs' `agent.language` to the current `app.language` on first run if we want to preserve backward compatibility.
