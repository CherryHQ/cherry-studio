# rebrand-003-explicit-userdata

**Phase:** rebrand-to-the-boss
**Plan:** ../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md
**Order:** 3 · **Depends on:** rebrand-002 · **Risk:** HIGH

## Why

userData is currently name-derived: a normal packaged run skips all three setPath branches, so renaming the app would silently orphan chats, the SQLite DB, and Chromium storage.

## What changes

Add explicit setPath('userData') for packaged non-portable, sourced from branding module. Change CHERRY_HOME_DIRNAME and pathRegistry temp dir in the same change so BootConfig and userData never disagree. D1: start clean, no migration; log loudly when a legacy dir is detected but not adopted.

## Acceptance

See the matching section in [plan.md](../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md).
