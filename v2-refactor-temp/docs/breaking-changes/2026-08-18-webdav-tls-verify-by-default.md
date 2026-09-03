---
title: WebDAV backup now verifies TLS certificates by default
category: changed
severity: breaking
introduced_in_pr: '#18793'
date: 2026-08-18
---

## What changed

WebDAV backups and restores now validate the server's TLS certificate by default. Previously any certificate — including one presented by a man-in-the-middle — was accepted. A new setting "Allow Self-Signed Certificates" (Settings → Data → WebDAV) restores the old behavior: when enabled, certificate verification is skipped entirely for that server (expired and wrong-hostname certificates are accepted too, not just self-signed or private-CA ones).

Backup archives and staging directories are additionally written owner-only (0600/0700 — POSIX semantics only; Windows does not enforce these modes). Archives downloaded for a WebDAV/S3 restore keep default file modes but rest inside owner-only (0700) staging directories. On filesystems that reject `chmod` outright (FAT/exFAT-class mounts), operations that must tighten an existing directory or archive abort rather than writing under looser permissions; v2 archive writes apply the mode at file creation instead. These aborts surface through the generic backup failure toast, with the specific cause in the error message.

## Why this matters to the user

Users whose WebDAV server presents a self-signed or private-CA certificate (common for self-hosted NAS setups) will see backup/restore/connection failures. Unverifiable-chain failures show a message pointing at the new setting; other certificate problems (expired, wrong hostname) show a generic failure message — those need the certificate fixed, not verification skipped. Plain-HTTP servers (e.g. LAN `http://` hosts) are not affected.

Nutstore backups use the same transport and are now verified too. `dav.jianguoyun.com` serves a publicly-trusted certificate, so normal environments are unaffected. Networks that intercept TLS (e.g. corporate proxies with an untrusted root) will fail nutstore backups with a generic error. Note that the backup transport runs in the main process and trusts only its compiled-in CA bundle — it does not read the operating system's trust store, so installing the corporate root certificate system-wide will not fix this. Working remedies are launching Cherry Studio with `NODE_EXTRA_CA_CERTS=/path/to/corporate-root.pem` or exempting `dav.jianguoyun.com` from interception at the network boundary; the WebDAV self-signed switch does not apply to nutstore.

## What the user should do

If your WebDAV server uses a self-signed or private-CA certificate, enable "Allow Self-Signed Certificates" in Settings → Data → WebDAV. Note this skips certificate verification entirely for that server — a man-in-the-middle could then intercept your WebDAV password and backup data. Everyone else needs to do nothing.

On POSIX systems, backup archives (including local backups written into user-chosen directories) are now readable only by the owning account — if you share a backup folder across accounts, chmod the archive files after creation (e.g. `chmod g+r`) or move them out of the shared folder.

## Notes for release manager

The failure toast for chain-trust certificate failures guides users to the setting; other certificate failures keep the generic copy.
