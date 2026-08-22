---
title: HTML preview popup consent-gates scripts in a hardened webview
category: changed
severity: notice
introduced_in_pr: '#18764'
date: 2026-08-22
---

## What changed

The full-screen HTML preview popup no longer runs scripts in a same-origin iframe. Active HTML — a script-bearing document **or fragment** — now opens in a hardened isolated webview when the user explicitly opens the popup (opening it is the consent); inert HTML still renders in the script-less frame as before.

## Why this matters to the user

Interactivity is preserved: script-driven fragments and documents keep working once the popup is opened — same one-click experience as before, now isolated from the app's privileged bridge. The "save/copy PNG" capture menu is hidden while the interactive (webview) tier is showing, since that tier has no capture surface. The inline chat preview is unchanged: successfully generated assistant artifacts already rendered under this policy, and non-consented inline surfaces keep fragments script-less.

## What the user should do

Nothing for previews. For capturing an interactive preview, use "open in external browser" or download it instead of the capture menu (capture still works for inert previews).

## Notes for release manager

Security motivation: a same-origin scripted iframe reaches the preload IPC bridge (`parent.api`) regardless of sender validation (the bridge closure executes in the parent frame); a live PoC on the old default read `/etc/hosts` through it. Tiering follows consent state (review feedback on PR #18764): explicit popup open = consent = webview for any active content; automatic/inline rendering stays script-less for fragments per the documented `HtmlArtifactViewProps.kind` model. Related hardening in the same PR: unclassified previews fail closed to a script-less sandbox by default.
