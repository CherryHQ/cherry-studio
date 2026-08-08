---
title: '"Recent messages kept" returns, and v1 assistants keep their old limit'
category: data-migration
severity: notice
introduced_in_pr: "#18192"
date: 2026-08-08
---

## What changed

The v1 "Context count" setting is back as "Recent messages kept", now in two places: Settings › Model › Context Management (global) and each assistant's Model tab. Leaving it empty means no limit, which is the v2 default for new installs. Migrated v1 assistants keep their old `contextCount` value instead of it being dropped — v1's default was 5, so most migrated assistants arrive with a limit of 5 recent messages. v1's "max" setting (100) migrates to no limit.

Setting a limit takes over as the context policy: history is cut to that window and automatic compression no longer summarizes older turns for that assistant. Assistants left at no limit keep the v2 behavior of sending full history with compression handling the overflow.

The assistant's "Context management" switch is also renamed to "Customize context management" — it always overrode the global settings; the old name read as if it turned the feature off.

## Why this matters to the user

Users upgrading from v1 will find their assistants answering from the last 5 messages, exactly as in v1, rather than the full conversation v2 otherwise sends. That also means those assistants do not get v2's automatic compression until the limit is cleared. Anyone who wants v2's behavior has to clear the field per assistant (or set the global one and clear the assistant override).

The window applies to attachments too: a file attached in a message that falls outside it stops being reachable, including through the `read_file` tool. That is deliberate — the limit is a boundary the user drew, so leaving the file readable would let the model pull it back in and defeat the setting. Content folded away by automatic compression is different and stays reachable, because folding is the app saving space rather than the user excluding something.

## What the user should do

Nothing is required. To adopt v2's full-history + compression behavior, clear "Recent messages kept" in Settings › Model › Context Management and on any assistant that carries its own value.

## Notes for release manager

The migrated default of 5 comes from v1's `DEFAULT_CONTEXTCOUNT`, which v1 wrote into every assistant, so this affects effectively all upgrading users rather than only those who tuned the setting. Worth calling out explicitly in the release note alongside the context-management entry, since "compression is on by default" and "your migrated assistants have compression bypassed" would otherwise read as contradictory.
