---
title: V1 custom CSS requires review before use in v2
category: data-migration
severity: breaking
introduced_in_pr: TBD
date: 2026-07-23
---

## What changed

Migrated v1 custom CSS is preserved for export but is no longer applied automatically in v2. Settings → Appearance uses a separate v2 custom CSS field and shows an "Export legacy styles" button only when migrated v1 CSS exists.

## Why this matters to the user

Users upgrading with custom CSS will initially see the standard v2 appearance. This prevents selectors written for the v1 interface from unexpectedly breaking the redesigned v2 interface.

## What the user should do

Export the legacy styles from Settings → Appearance, review and adapt them for the v2 interface, then paste the compatible rules into the v2 custom CSS editor.

## Notes for release manager

The migrated v1 value remains stored separately and is not deleted when users edit their v2 custom CSS.
