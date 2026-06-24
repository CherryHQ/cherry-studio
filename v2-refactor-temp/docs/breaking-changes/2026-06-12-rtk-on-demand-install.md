---
title: "RTK is now installed on demand"
category: changed
severity: notice
introduced_in_pr: "#15184"
date: 2026-06-12
---

## What changed

RTK is no longer bundled and extracted automatically during app startup. Users who want RTK command rewriting need to install RTK from Settings → Plugins.

## Why this matters to the user

Claude Code command output compression will stay disabled until RTK is installed. Normal command execution still works; only the token-saving rewrite layer is absent.

## What the user should do

Install RTK from Settings → Plugins if you rely on RTK-powered command rewriting.

## Notes for release manager

This is part of the BinaryManager consolidation: CLI tools move to the unified plugin-managed binary flow instead of feature-specific bootstrap extraction.
