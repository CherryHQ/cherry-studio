---
title: Agent search results no longer expose hidden reasoning
category: changed
severity: notice
introduced_in_pr: "#17661"
date: 2026-07-30
---

## What changed

Global search now indexes only the visible text of Agent session messages.
Previously indexed reasoning is removed automatically during upgrade.

## Why this matters to the user

Agent search results and snippets no longer reveal model reasoning that is
hidden from the session page. Visible answer text remains searchable.

## What the user should do

Nothing — automatic.
