---
title: Some MCP sync providers removed
category: removed
severity: notice
introduced_in_pr: TBD
date: 2026-06-27
---

## What changed

The MCP provider sync page no longer lists Lanyun, 302.AI, or MCP Router as server discovery providers. ModelScope and Alibaba Cloud Bailian remain available.

## Why this matters to the user

Users can no longer browse or sync MCP servers from Lanyun, 302.AI, or MCP Router through the built-in MCP provider page. Existing MCP servers that were already added to the local server list are not removed by this UI change.

## What the user should do

Use ModelScope, Alibaba Cloud Bailian, or manually add MCP server configuration JSON for servers from other sources.

## Notes for release manager

- Removed providers from the MCP sync provider list: Lanyun, 302.AI, MCP Router.
- This does not remove unrelated model provider labels or OAuth handling for providers that still exist elsewhere in the app.
