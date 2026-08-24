---
title: MCP package uploads are limited to 50 MiB
category: changed
severity: breaking
introduced_in_pr: "#19288"
date: 2026-08-24
---

## What changed

DXT and MCPB packages larger than 50 MiB are rejected before they are transferred to the main process.

## Why this matters to the user

Users importing an unusually large MCP package will now see a size-limit error instead of starting the installation.

## What the user should do

Reduce the package below 50 MiB, for example by removing unnecessary bundled assets, and import it again.

## Notes for release manager

The renderer, IPC validation, and main-process validation all enforce the same shared limit.
