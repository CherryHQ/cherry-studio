---
title: Message deletion now preserves conversation branches
category: changed
severity: notice
introduced_in_pr: "#17996"
date: 2026-08-06
---

## What changed

First-turn messages can now be deleted with the same splice behavior as other messages. Deleting a multi-model reply group removes only the assistant replies while preserving the user's question and later messages. Single-message, multi-model group, and multi-select deletion are unavailable while the affected assistant reply is still generating.

## Why this matters to the user

Deleting messages no longer removes an entire conversation subtree when the action represents only a multi-model reply group.

## What the user should do

Nothing — automatic.

## Notes for release manager

The multi-model group deletion confirmation copy was updated to describe the preserved messages. The new `message.delete.generating_unavailable` copy explains why deletion is disabled during generation.
