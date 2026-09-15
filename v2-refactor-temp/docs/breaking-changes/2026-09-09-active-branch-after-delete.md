---
title: The conversation follows a surviving reply after a deletion instead of ending at the question
category: changed
severity: notice
introduced_in_pr: '#20254'
date: 2026-09-09
---

## What changed

Deleting the message the conversation is currently on now moves the view to the newest surviving message below it — the remaining replies of the turn, a surviving regenerated reply, or the follow-up messages the deletion just moved. Previously the view stopped at the deleted message's neighbour or at the user question, hiding whatever still existed below it.

## Why this matters to the user

Deleting one reply no longer makes the rest of the turn look empty or truncates the conversation at the question. Because the view now follows the survivor all the way down, follow-up messages that were hidden while a single reply was selected can reappear after a deletion.

## What the user should do

Nothing — automatic. Use the branch view or the reply tabs to move to a different branch if the chosen one is not wanted.

## Notes for release manager

Fixes issue #20253. Extends #20233, which only covered handing context to another reply of the same multi-model group. Deleting the last message of a topic still leaves an empty conversation.
