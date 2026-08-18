---
title: WebDAV backup now verifies TLS certificates by default
category: changed
severity: breaking
introduced_in_pr: '#TBD'
date: 2026-08-18
---

## What changed

WebDAV backups and restores now validate the server's TLS certificate by default. Previously any certificate — including one presented by a man-in-the-middle — was accepted. A new setting "Allow Self-Signed Certificates" (Settings → Data → WebDAV) restores the old behavior for servers that use self-signed certificates.

## Why this matters to the user

Users whose WebDAV server presents a self-signed certificate (common for self-hosted NAS setups) will see backup/restore/connection failures with a message pointing at the new setting. Plain-HTTP servers (e.g. LAN `http://` hosts) are not affected.

## What the user should do

If your WebDAV server uses a self-signed certificate, enable "Allow Self-Signed Certificates" in Settings → Data → WebDAV. Be aware this weakens transport security: a man-in-the-middle could intercept your WebDAV password and backup data. Everyone else needs to do nothing.

## Notes for release manager

The failure toast for certificate errors guides users to the setting. Related hardening in the same PR: backup archives are now created owner-only (0600) — this also applies to local backups written into user-chosen directories, which matters for users sharing a backup folder across accounts. Staging directories under the OS temp tree are additionally 0700.
