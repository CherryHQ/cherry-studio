---
title: Web fetching works again behind fake-IP proxies and on IPv6-only networks
category: platform
severity: notice
introduced_in_pr: "#18791"
date: 2026-08-18
---

## What changed

The SSRF guard on `@cherry/fetch`, `web_fetch`, web search content extraction, and citation previews no longer treats the proxy fake-IP range (`198.18.0.0/15`) or NAT64 addresses as private. NAT64 targets are now judged by the IPv4 address they embed, and a hostname that returns several addresses connects through a public one instead of failing outright.

## Why this matters to the user

Users running Clash/mihomo TUN, Surge Enhanced Mode, or any fake-IP proxy saw every fetch fail with `Unsafe remote url: DNS resolved to local or private address`. Users on IPv6-only or 464XLAT networks saw the same. Both now work.

## What the user should do

Nothing — automatic. Localhost, RFC 1918, carrier-grade NAT, link-local (including cloud metadata at `169.254.169.254`), multicast, broadcast, and the remaining reserved ranges are still rejected, including when reached through NAT64. A proxy configured with a fake-IP range other than the `198.18.0.0/15` default is still blocked.

## Notes for release manager

Supersedes the "Clash Fake-IP addresses are still rejected" caveat in `2026-07-21-web-lookup-terminal-errors.md`. The proxy limitation recorded in `2026-07-15-citation-preview-proxy-limit.md` is unchanged — that one is about the Chromium session proxy, not the address filter.
