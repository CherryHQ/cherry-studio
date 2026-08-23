---
title: Agent reply language decoupled from UI language
category: changed
severity: breaking
introduced_in_pr: #19160
date: 2026-08-22
---

## What changed

Agent reply language is now controlled by a dedicated preference `agent.language` (global) and per-agent `configuration.language`, decoupled from the UI language (`app.language`).

- Global `agent.language`: `null` (default) = no language constraint is injected. A non-empty single-line human-readable string (e.g. "English", "ไทย", "中文") becomes the default. Legacy persisted `"auto"` is treated as `null` for backwards compat.
- Per-agent `configuration.language`: `undefined` (missing) = inherit global, `null` or `"auto"` = explicitly no constraint (opt-out), non-empty single-line string = override. Values are trimmed and only the first line is used; empty/whitespace inherits.
- No implicit `app.language` fallback — following the UI language must be an explicit user choice. Set `agent.language` to "English" (or the desired display name) to restore the previous "reply in UI language" behavior.
- The language instruction is deferential and positioned immediately after the Instruction Precedence block (before `SOUL.md`/workspace content): `By default, respond in <language>. If the Agent System Prompt, Workspace Instructions, or Agent Persona (SOUL.md) specifies a different language, follow that instruction instead.` Persona/instructions naturally win via position + explicit deference.

Rebuild contract: the effective language is a rebuild fact on all three runtimes (Pi, Dsh, Claude Code). Changing the global or per-agent language invalidates the warm connection on the next reconcile so the new prompt is baked into the next system prompt and prompt cache. This trades cache preservation for correctness — the first turn after a change pays full input-token cost until the new prefix is cached, but the user sees the new language on the next reconcile rather than only on the next natural connection.

## Why this matters to the user

Before this PR, every agent turn injected `IMPORTANT: You must respond in <UI language>` (tightly coupled to `app.language`). After, no language is injected by default; the model chooses. Users who previously relied on implicit "reply in my UI language" will see model-native replies until they set `agent.language` explicitly. Neither the global preference nor the per-agent override is currently exposed in the settings UI — they are only configurable by editing the Electron store / agent JSON directly.

## What the user should do

- To keep replying in your UI language: set `agent.language` to the desired language name (e.g. "English", "中文") via the Electron store. A UI picker is planned as a follow-up.
- To let the model decide: leave `agent.language` as `null` (default) and do not set per-agent `language`.
- To suppress language for a single agent while a global default is set: set that agent's `configuration.language` to `null` (or legacy `"auto"`).

## Notes for release manager

Two-level design without a magic string (`null` = no constraint). Follow-up should surface at least the global `agent.language` picker and the per-agent override in `AgentEditDialog` so users can configure this without editing JSON. Do not reintroduce an implicit `app.language` fallback — if following the UI is ever desired, it must be a separate explicit mode. The rebuild-vs-cache tradeoff above is intentional and tested (`changes the rebuild signature when the effective agent language changes`).
