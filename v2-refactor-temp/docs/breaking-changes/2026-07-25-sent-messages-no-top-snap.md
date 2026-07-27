---
title: Sent messages no longer snap to the viewport top
category: changed
severity: notice
introduced_in_pr: "#17415"
date: 2026-07-25
---

## What changed

Sending a message in Chat or an Agent session no longer moves that message to the top of the message viewport. When the prior position was within one viewport of the bottom, the list returns to the live bottom and follows the reply; when it was farther away, the reading position is preserved.

## Why this matters to the user

Users who only moved slightly away from the latest message continue seeing the streamed response automatically. Users reading history more than one viewport away are not pulled away from that context.

## What the user should do

Nothing — automatic.

## Notes for release manager

Manual top, bottom, and message navigation and per-conversation scroll restoration are unchanged.
