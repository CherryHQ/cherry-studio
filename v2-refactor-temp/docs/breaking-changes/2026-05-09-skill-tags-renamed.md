---
title: Skill metadata tags are exposed as source tags
category: changed
severity: notice
introduced_in_pr: "#14442"
date: 2026-05-09
---

## What changed

Skill metadata tags from `SKILL.md` are now exposed as `sourceTags` instead of `tags` in the v2 skill API.

## Why this matters to the user

The Resource Library keeps user-managed library tags assistant-only. Skill detail pages still show the metadata tags, but they are treated as source metadata rather than editable library tags.

## What the user should do

nothing - automatic

## Notes for release manager

Mention this only if the release notes discuss Resource Library tag behavior or skill metadata fields.
