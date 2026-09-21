# rebrand-002-branding-module

**Phase:** rebrand-to-the-boss
**Plan:** ../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md
**Order:** 2 · **Depends on:** rebrand-001 · **Risk:** medium

## Why

Single fork-owned source of truth is what keeps upstream merges cheap; without it, branding literals scatter across 2061 files and conflict forever.

## What changes

Create src/shared/branding/ with typed constants (product name, appId, home dirname, URLs, asset paths). Migrate CHERRY_HOME_DIRNAME and the X-Title pair as proof of concept.

## Acceptance

See the matching section in [plan.md](../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md).
