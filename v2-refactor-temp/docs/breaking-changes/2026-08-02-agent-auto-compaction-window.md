---
title: Work Agent compaction follows the model window
category: changed
severity: notice
introduced_in_pr: "#17737"
date: 2026-08-02
---

## What changed

Work Agent now aligns Claude Code's automatic-compaction threshold with the selected model's declared context window. Context windows from 100,000 through 1,000,000 tokens are used directly, while larger declared windows are capped at Claude Code's 1,000,000-token maximum.

## Why this matters to the user

Long-context models no longer compact at Claude Code's generic 200,000-token default when Cherry Studio has more accurate model metadata. Editing that metadata also rebuilds the Work Agent connection before the next turn so the new threshold takes effect.

## What the user should do

Nothing — this is automatic. For custom models, keep the model's context-window metadata accurate.

## Notes for release manager

Claude Code rejects `autoCompactWindow` values below 100,000. Models below that limit, and models without context metadata, still use the SDK's 200,000-token default and need a separate host-side early-compaction solution.
