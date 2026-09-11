---
title: New assistants no longer use all MCP servers automatically
category: changed
severity: notice
introduced_in_pr: 9c349245e8
date: 2026-08-03
---

## What changed

The default MCP mode for assistants changed from `auto` to `manual`. Newly created (and seeded) assistants no longer pick up every active MCP server automatically — they use only the MCP servers explicitly linked in the assistant's settings.

## Why this matters to the user

A new assistant starts with no MCP tools, where it previously offered the tools of all active MCP servers without any setup. Users who rely on MCP tools will notice they are absent on fresh assistants until servers are linked. Existing assistants keep their stored mode and are unaffected.

## What the user should do

Enable the desired MCP servers in the assistant's settings (or switch the assistant's MCP mode back to automatic) for each new assistant that should use MCP tools.

## Notes for release manager

Motivation: the three layers (main / shared / renderer) previously disagreed on the fallback mode (`manual`/`disabled` vs `auto` vs `disabled`), so the same assistant could resolve a different tool set depending on the code path — the unified `manual` default makes tool resolution deterministic. Related fix in the same commit: cold MCP catalogs are now warmed before tool resolution instead of silently resolving to an empty tool set.
