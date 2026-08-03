---
title: Cherry Assistant gains guarded attachment and feedback workflows
category: other
severity: notice
introduced_in_pr: "#17398"
date: 2026-07-27
---

## What changed

Cherry Assistant can read conversation attachments through opaque handles and, after approval, save their original bytes to its workspace. Its bundled workflows also include Skill discovery and creation guidance.

Confirmed deletion of ordinary workspace files and directories now moves them to the operating-system trash. Cherry Assistant refuses permanent deletion commands, protected roots and critical user/system data, and requests that enable unlawful or destructive abuse.

Cherry Assistant consistently presents itself as Cherry Assistant rather than its underlying runtime. It can also collect consented, redacted diagnostics for a Cherry Studio problem, preview the resulting feedback, submit it to the current Feishu feedback form, or create a workspace ZIP for anonymous manual upload. Feishu is the default for unspecified feedback submissions; GitHub Issues remain a separate workflow used only when explicitly requested.

Ordinary Agents can also attach ZIP, RAR, 7Z, TAR, GZ, TGZ, BZ2, and XZ archives as tool-readable workspace files.

## Why this matters to the user

Users can complete attachment, recoverable workspace-cleanup, and structured feedback tasks inside an Agent session without giving automatic edit mode permission to permanently erase files or automatically uploading diagnostics.

## What the user should do

Nothing - the workflows are available automatically. Cherry Assistant still asks before saving attachment bytes, moving a workspace item to trash, collecting local diagnostics, submitting feedback, or installing third-party Skills.
