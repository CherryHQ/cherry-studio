---
title: Web fetch no longer hands private or unresolvable URLs to Jina Reader
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-09-03
---

## What changed

When the built-in web fetch fails and falls back to Jina Reader, the URL is now checked against the public-network guard first, and that check ignores "Allow fetching local network addresses". A `localhost` or LAN target, a hostname that resolves to a private address, or a hostname the local DNS cannot resolve at all is never sent to Jina; the original fetch error is reported instead.

## Why this matters to the user

Previously, with "Allow fetching local network addresses" on (the default), a failed fetch of an intranet page such as a NAS, wiki, or dev server sent the full URL, including path and query string, to the third-party Jina Reader service. Jina could never reach those hosts, so no content was lost, but the URL itself was disclosed. That disclosure is now gone. The one visible narrowing: a public domain that the local resolver blocks (for example a Pi-hole or corporate filtering DNS) used to reach Jina through the fallback and now stays failed.

## What the user should do

Nothing — automatic. Users who rely on the Jina fallback for domains their local DNS blocks can select Jina as the fetch provider directly instead of relying on the fallback.

## Notes for release manager

Related to [[2026-08-18-fetch-allows-private-network-by-default]]: that switch still governs what the app itself may connect to; it never governed what may leave the machine, which this entry makes explicit. Clash/Surge fake-IP targets still pass the guard via the `198.18.0.0/15` carve-out from [[2026-08-18-fetch-allows-fake-ip-and-nat64]].
