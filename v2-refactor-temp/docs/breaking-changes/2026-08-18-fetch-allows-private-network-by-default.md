---
title: Web fetch tools can reach localhost and LAN addresses by default
category: changed
severity: notice
introduced_in_pr: "#18791"
date: 2026-08-18
---

## What changed

Settings → General gains "Allow fetching local network addresses", **on by default**. While it is on, `@cherry/fetch`, `web_fetch`, web search content extraction, and citation previews may connect to `localhost`, RFC 1918 LAN addresses, and any other private target. Turning it off restores the previous behavior, which rejected them outright.

## Why this matters to the user

Fetching a self-hosted wiki, a NAS, a local dev server, or a router page now works instead of failing with `Unsafe remote url`. It also means a model can be steered — by a prompt injection on a page it fetches — into reading services on the user's own machine or LAN and pulling that content into the conversation.

## What the user should do

Nothing to start using it. Users who run sensitive services on localhost or their LAN, or who let assistants fetch untrusted pages, should turn the switch off in Settings → General.

## Notes for release manager

**action required** for security-sensitive users — this is the one entry in this release that widens what an auto-callable tool can reach. Worth calling out explicitly in the release note rather than folding into the fake-IP fix ([[2026-08-18-fetch-allows-fake-ip-and-nat64]]). Scheme, credential, redirect, and response-size rules are unchanged, and the connection is still pinned to the prevalidated address.
