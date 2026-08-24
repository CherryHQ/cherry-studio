---
title: Agent sessions keep only their primary workspace
category: data-migration
severity: notice
introduced_in_pr: TBD
date: 2026-05-19
---

## What changed

During the v1 to v2 migration, each legacy agent session now keeps only the first
valid `accessible_paths` entry as its workspace. Additional accessible paths from
the same legacy list are not migrated into the v2 workspace table.

## Why this matters to the user

Users who configured multiple accessible directories for an agent or session in
v1 will see only the primary directory attached to the migrated v2 session.
Claude Code sessions will run from that single workspace directory.

## What the user should do

Recreate any extra directory access manually after upgrading if it is still
needed.

## Notes for release manager

This follows the v2 workspace model: one workspace row is one normalized
absolute path, and one agent session binds to one workspace.
