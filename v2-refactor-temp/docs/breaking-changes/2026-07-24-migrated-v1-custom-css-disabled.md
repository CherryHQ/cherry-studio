---
title: Migrated v1 custom CSS is disabled in v2
category: data-migration
severity: breaking
introduced_in_pr: "#17344"
date: 2026-07-24
---

## What changed

Migrated v1 custom CSS remains in the Custom CSS editor but is prefixed with a versioned marker and is no longer applied automatically in v2. The warning also provides an export action for saving the original stylesheet as a CSS file.

## Why this matters to the user

Users upgrading with custom CSS will initially see the standard v2 appearance. This prevents selectors written for the v1 interface from unexpectedly breaking the redesigned v2 interface.

## What the user should do

Open Settings → Appearance and export the legacy stylesheet if you want to keep a copy. Replace the editor contents with CSS written for the v2 interface before using custom styles again.

## Notes for release manager

The marker is migration metadata. Custom CSS injection skips the entire stylesheet in every standard window while the marker remains.
