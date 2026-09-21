# rebrand-0075-preboot-identity

**Phase:** rebrand-to-the-boss
**Plan:** ../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md
**Order:** 7.5 · **Depends on:** rebrand-002, rebrand-004 · **Risk:** low

## Why

Adversarial vet found hardcoded 'CherryStudio' in 15 non-test files under src/main that i18n would never reach: OS-level and third-party identity.

## What changes

Route crashReporter, Chromium window class, tracer name, OAuth client name, tray tooltip, and MCP/skill client identity through the branding module. Audit LegacyBackupManager for filesystem coupling.

## Acceptance

See the matching section in [plan.md](../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md).
