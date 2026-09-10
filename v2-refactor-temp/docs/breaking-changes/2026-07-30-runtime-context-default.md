---
title: New Assistants enable Runtime context
category: changed
severity: breaking
introduced_in_pr: "#17281"
date: 2026-07-30
---

## What changed

New Assistants have Runtime context enabled by default. Existing Assistants,
Assistants migrated from v1, and Assistants imported from the legacy format keep
it disabled. Existing and migrated Agents also remain opt-in.

## Why this matters to the user

When Runtime context is enabled, Cherry Studio includes the current date and
time, operating system, CPU architecture, application language, model name, and
username in the system context sent to the selected model provider.

## What the user should do

In Library, edit the Assistant or Agent, select the Prompt tab, and turn off
Runtime context. Use the adjacent settings icon to review or edit the Runtime
context preset.

## Notes for release manager

This change does not add an Agent import flow. Do not describe imported Agent
behavior in the release note.
