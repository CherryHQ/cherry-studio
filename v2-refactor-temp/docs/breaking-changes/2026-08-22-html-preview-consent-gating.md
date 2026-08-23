---
title: HTML preview popup consent-gates scripts in a hardened webview
category: changed
severity: notice
introduced_in_pr: '#18764'
date: 2026-08-22
---

## What changed

The full-screen HTML preview popup (opened from a code-block card) no longer runs scripts in a same-origin iframe. It now opens in the script-less static tier by default; when the content is active (scripts, embeds, external resources), an explicit **"run interactive preview"** action appears, and only that mounts the hardened isolated webview — the same consent wording the inline preview already uses.

## Why this matters to the user

Opening the popup now always shows the safe static rendering first; interactivity is one deliberate click away (per-open, not remembered). While static, the "save/copy PNG" capture menu is available; entering the webview hides it (that tier has no capture surface — use "open in external browser" / download instead). External-resource content (e.g. linked images) renders fully only in the webview tier; the static tier blocks external resources by design, same as the inline static preview. The inline chat preview keeps its existing behavior. The maximize popup keeps its open-interactive behavior for documents, and now also runs active **fragments** there (previously static in that popup) — one extra visible change, recorded here for completeness.

## What the user should do

Click "run interactive preview" when you want an active artifact to execute; nothing else changes.

## Notes for release manager

Security motivation: a same-origin scripted iframe reaches the preload IPC bridge (`parent.api`) regardless of sender validation (the bridge closure executes in the parent frame); a live PoC on the old default read `/etc/hosts` through it. Tiering follows explicit authorization (review feedback on PR #18764): the card popup defaults static and activates the webview only via the "run interactive preview" action; the maximize outlet treats its documented open action as authorization (documents as before, fragments newly included); automatic/inline rendering stays script-less for fragments per the documented `HtmlArtifactViewProps.kind` model. Related hardening in the same PR: unclassified previews fail closed to a script-less sandbox by default.
