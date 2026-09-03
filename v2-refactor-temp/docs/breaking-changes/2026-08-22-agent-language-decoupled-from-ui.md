---
title: Agent replies are no longer forced to follow the UI language
category: changed
severity: notice
introduced_in_pr: #19160
date: 2026-08-22
---

## What changed

Agents now choose their reply language freely instead of always being told to
respond in the UI language. A new Agent language setting (global default plus a
per-agent override) lets users pin a specific reply language when they want one;
when set, persona and workspace instructions can still override it.

## Why this matters to the user

Previously every agent reply was forced into the UI language, which could fight
with personas or instructions written in another language. After upgrading,
agents follow the language of the conversation by default — usually what the
user wants. Users who relied on the old behavior can restore it with the new
setting.

## What the user should do

Nothing — automatic.

## Notes for release manager

The global preference (`agent.language`) and the per-agent override are not yet
exposed in the settings UI at the time of this PR; a follow-up adds the picker.
Until then the default behavior (reply language follows the conversation) needs
no configuration, so this entry stays `notice`. Changing an agent's language
rebuilds its warm connection, so the first turn after a change pays full
input-token cost until the new prompt prefix is cached.
