---
title: Default tool-call round cap raised from 20 to 100
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-07
---

## What changed

The default value of the assistant setting "Max tool call rounds" changed from 20 to 100, and the configurable ceiling changed from 100 to 1000. The error shown when a turn exhausts the cap now names the setting to raise.

## Why this matters to the user

Deep, tool-heavy tasks (MCP servers such as IDA Pro, or the built-in file-system tools) routinely need more than 20 sequential tool rounds. On the old default those turns failed with "reached the tool-call limit" before producing an answer. New and seeded assistants now get 100 rounds, and advanced users can raise it to 1000.

## What the user should do

Existing assistants keep the value stored in their settings (20 for assistants created before this change). Raise "Max tool call rounds" in the assistant's Model settings if long tool chains keep hitting the cap.

## Notes for release manager

Reported as issue #17984. The cap remains a hard stop by design — the turn ends with an explicit error rather than silently truncating — so only the numbers and the error copy changed.
