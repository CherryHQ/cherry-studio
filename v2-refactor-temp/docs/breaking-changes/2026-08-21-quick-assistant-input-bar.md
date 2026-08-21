---
title: Quick assistant is now an input bar that expands into a chat panel
category: changed
severity: notice
introduced_in_pr: "#19106"
date: 2026-08-21
---

## What changed

The quick assistant opens as a single input bar built on the same composer as the main
chat window — attachments, quick phrases, `/` and `@` panels, model and assistant
switching, plus a new screenshot button. Sending grows the window into a message panel
that renders answers exactly like the main window, with a control bar to save the
conversation as a topic or open it in the main window.

Three things went away with the old layout:

- The feature menu (Translate / Summary / Explanation) and its dedicated translate view.
  These overlap with the selection assistant, which keeps them.
- Reading the clipboard at startup, along with its settings switch. Clipboard content is
  now pasted (or dropped) into the composer like anywhere else in the app.
- The live preview of the quick assistant window inside Settings › Quick Assistant.

## Why this matters to the user

Anyone who used the quick assistant for one-shot translation or summarisation will not
find those entries after pressing the hotkey; the selection toolbar is where they live.
Everyone else gets a bar that behaves like the main composer — including attachments and
multi-turn conversations, which the old single-line input could not do.

Quick assistant conversations are still temporary: they stay out of the topic list unless
"Save as topic" is pressed. Saving does not interrupt an answer in progress.

## What the user should do

Nothing — automatic. For quick translation or explanation of selected text, use the
selection assistant (Settings › Selection Assistant).

## Notes for release manager

The screenshot button only appears when Settings › Screenshot is enabled, and it copies
the capture to the clipboard on its way into the composer — the clipboard is overwritten
by design, matching the existing capture shortcut.
