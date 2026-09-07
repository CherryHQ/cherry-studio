---
title: MCP OAuth credentials require secure system storage
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-29
---

## What changed

MCP OAuth tokens, client secrets, and PKCE data are no longer written to disk as plaintext. When the operating system's secure storage is unavailable, Cherry Studio keeps new credentials only for the current process.

## Why this matters to the user

Users on a system where secure storage is unavailable may need to authorize an OAuth-protected MCP server again after restarting Cherry Studio.

## What the user should do

Reauthorize the MCP server when prompted. No action is required when system secure storage is available.

## Notes for release manager

Legacy plaintext files are scrubbed during the first read. Credentials are encrypted and retained when secure storage is available; otherwise they become process-only.
