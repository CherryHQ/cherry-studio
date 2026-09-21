# rebrand-006-i18n-strings

**Phase:** rebrand-to-the-boss
**Plan:** ../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md
**Order:** 6 · **Depends on:** rebrand-004 · **Risk:** medium

## Why

89 user-visible values carry the Cherry brand; menus inherit automatically via t() and app.name.

## What changes

Edit 76 renderer + 13 main en-us.json values, run pnpm i18n:sync, translate placeholders across 13 locales x 2 trees. Do NOT rename the 51 structural keys. Decide remove-vs-rebrand for built-in cherry_assistant/cherry_support agents.

## Acceptance

See the matching section in [plan.md](../../../.kbd-orchestrator/phases/rebrand-to-the-boss/plan.md).
