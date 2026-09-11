---
title: Message header shows the producing assistant/agent first, model is secondary
category: changed
severity: notice
introduced_in_pr: #16318
date: 2026-06-30
---

## What changed

Each message now displays the assistant (chat) or agent (session) that produced
it as the primary avatar + name in the header, with the model demoted to a small
muted secondary label. The producing author and model are frozen onto the
message at send time, so a renamed or deleted assistant/agent/model still shows
its original identity on past messages.

## Why this matters to the user

The header previously led with the model. Existing conversations will now read
"<Assistant name> · <model>" instead of model-first, and historical messages keep
the author/model they were generated with even after the live entity is renamed
or removed.

## What the user should do

Nothing — automatic. Newly sent messages capture the snapshot; older messages
without one fall back to their stored model id.

## Notes for release manager

Purely presentational + per-message metadata; no data loss.

v1-imported chat messages **do** get an author snapshot when the topic's assistant
and the message's model resolve during migration; only rows where that can't be
resolved stay snapshot-less.

Snapshot-less rows resolve their model from the row's own stored `modelId`. The
message header uses no live-model fallback, so switching the default model or the
assistant/agent never moves a past message's header. A row with neither a snapshot
nor a `modelId` simply shows no model label. (Session export still fills such rows
with the current agent model as a last resort, since an export is a one-shot
snapshot rather than a live-updating header.)
