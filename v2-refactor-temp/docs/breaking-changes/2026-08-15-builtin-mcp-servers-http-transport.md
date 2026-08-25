---
title: flomo, Nowledge Mem and QVeris MCP servers now connect over HTTP
category: data-migration
severity: notice
introduced_in_pr: #18630
date: 2026-08-15
---

## What changed

The built-in `@cherry/flomo`, `@cherry/nowledge-mem` and `@cherry/qveris` servers were
stored as "in-memory" servers while actually talking to an HTTP endpoint. Installed rows
are migrated on first launch to Streamable HTTP with their real URL
(`https://flomoapp.com/mcp`, `http://127.0.0.1:14242/mcp`, `https://mcp.qveris.ai/mcp`).
Legacy `@cherry/mcp-auto-install` rows still stored as in-memory become stdio, matching
the npx process they already ran.

## Why this matters to the user

In Settings → MCP these servers now show a Streamable HTTP type and a URL instead of
an in-memory type. Because OAuth tokens are keyed by server URL, a user who had
authorized flomo will be asked to authorize once more on the next connection.

## What the user should do

Nothing for the migration itself — it runs automatically. If flomo asks to authorize
again, complete the flow once.

## Notes for release manager

Only built-in rows still stored as in-memory are touched — a server the user added themselves,
one already migrated, and one never installed are all left alone. A migrated row adopts the
preset's connection, so an edit to the retired transport's command or args does not survive;
everything else the user owns (environment variables, enabled state, timeout, disabled tools)
is preserved.
