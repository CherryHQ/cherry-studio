---
title: MCP package uploads are limited to 50 MiB
category: changed
severity: breaking
introduced_in_pr: "#19288"
date: 2026-08-24
---

## What changed

DXT and MCPB packages larger than 50 MiB are rejected before they are copied into the app-managed staging area.

## Why this matters to the user

Users importing an unusually large MCP package will now see a size-limit error instead of starting the installation.

## What the user should do

Reduce the package to 50 MiB or smaller, for example by removing unnecessary bundled assets, and import it again.

## Notes for release manager

The renderer performs an early size check. Only the selected native path crosses IPC; the main process independently
validates the file and copies at most 50 MiB through a bounded stream before installation.
