---
title: Agent document attachments are read from local paths
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-06
---

## What changed

Agent sessions now send non-image attachments to the Agent as durable local file paths instead of automatically extracting PDF, HTML, and text content into the prompt. Uploaded copies remain attached to the message until that message is deleted or edited to remove them.

## Why this matters to the user

Agents choose the appropriate tool or parser for each document and retain access to the original bytes across later turns. A response may differ from the previous eager text-extraction behavior when an Agent decides not to inspect an attached file.

## What the user should do

Nothing — automatic. If a prompt requires the file to be inspected, state that explicitly.

## Notes for release manager

Images keep their existing native-image/OCR routing. Files already inside the Agent workspace remain direct workspace-path references rather than copied snapshots.
