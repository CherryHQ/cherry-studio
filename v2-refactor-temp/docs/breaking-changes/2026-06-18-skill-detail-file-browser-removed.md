---
title: Skill detail no longer has an in-app file browser / preview
category: removed
severity: notice
introduced_in_pr: #16187
date: 2026-06-18
---

## What changed

Opening a skill in the library now shows a metadata-only detail dialog. The v1/v2
skill **detail page** that rendered an expandable file tree with per-file markdown
and code preview is removed.

## Why this matters to the user

Users who browsed a skill's files and previewed their contents inside the app can
no longer do so from the skill detail view — only the skill's metadata is shown.

## What the user should do

Open the skill's folder on disk to inspect or edit its files.

## Notes for release manager

- Removed surface: `pages/library/detail/skill/SkillDetailPage.tsx` (+
  `skillFileTree.tsx`); replaced by the metadata-only `SkillDetailDialog.tsx`.
- Inherited verbatim from `feat/chat-page`; if the file browser is meant to return,
  it needs a home in/alongside `SkillDetailDialog` upstream.
