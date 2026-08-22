---
title: HTML preview popup consent-gates scripts; script fragments render static
category: changed
severity: breaking
introduced_in_pr: '#18764'
date: 2026-08-22
---

## What changed

The full-screen HTML preview popup (opened from a code-block card) no longer runs scripts in a same-origin iframe. A complete HTML document with active content (scripts, embeds) now opens in a hardened isolated webview — opening the popup is the consent. HTML **fragments** containing scripts now render as static previews (scripts stripped by the sandbox) instead of executing.

## Why this matters to the user

In the popup, interactive HTML that is a bare fragment (no `<!doctype html>`/`<html>` wrapper) loses its dynamic behavior — animations or script-driven widgets appear frozen. Script-bearing full documents still work interactively, but the "save/copy PNG" capture menu is hidden for them (the webview tier has no capture surface). Static previews and the inline chat preview are unchanged: successfully generated assistant artifacts already rendered this way, so the visible change is limited to code-block cards and failed/paused generations.

## What the user should do

Wrap interactive HTML in a complete document (`<!doctype html><html>…</html>`) to keep interactivity in the preview popup. For capturing an interactive document, use "open in external browser" or download it instead of the capture menu. Nothing changes for static content.

## Notes for release manager

Security motivation: a same-origin scripted iframe reaches the preload IPC bridge (`parent.api`) regardless of sender validation (the bridge closure executes in the parent frame); a live PoC on the old default read `/etc/hosts` through it. Fragment-stays-static mirrors the documented inline-preview model (`HtmlArtifactViewProps.kind`), so both paths now share one policy. Related hardening in the same PR: unclassified previews fail closed to a script-less sandbox by default.
