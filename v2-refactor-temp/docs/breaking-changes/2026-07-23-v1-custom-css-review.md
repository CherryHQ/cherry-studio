---
title: V1 custom CSS requires review before use in v2
category: data-migration
severity: breaking
introduced_in_pr: "#17300"
date: 2026-07-23
---

## What changed

Migrated v1 custom CSS remains in the Custom CSS editor but is prefixed with a versioned marker and is no longer applied automatically in v2.

## Why this matters to the user

Users upgrading with custom CSS will initially see the standard v2 appearance. This prevents selectors written for the v1 interface from unexpectedly breaking the redesigned v2 interface.

## What the user should do

Open Settings → Appearance, review and adapt the migrated CSS for the v2 interface, then remove the first marker line or choose "Enable for v2".

## Notes for release manager

The marker is migration metadata. Custom CSS injection skips the entire stylesheet in every standard window while the marker remains.
