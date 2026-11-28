# Agent Note: Enable globally enabled Skills for Agents by default

Status: implemented

English | [中文](2026-11-26-skill-global-enablement-defaults-to-agents.zh.md)

## Problem

Settings → Skills showed a local Skill as globally enabled, but the Agent skill list reported it as disabled for every Agent. The Skill had no `agent_skill` row, and the projection only defaulted built-in Skills to enabled. The composer Skill menu and the session Skill whitelist both read the Agent-level value, so an Agent could neither see nor call the Skill even though the library switch said it was on.

## Decision

The effective per-Agent state is `global_enabled AND (agent_skill override ?? activationState = 'active')`. When the global switch is on, a saved `agent_skill` choice takes precedence. Agents without an override inherit confirmed Skills.

Reconciliation registers newly discovered managed-library folders with `isEnabled: false` and `activationState: 'pending'`. Settings → Skills displays this state in the list and details. **Enable for Agents** sends `PATCH /skills/:skillId` with `isGlobalEnabled: true`, even when the saved switch is on. The PATCH saves the switch value and sets `activationState` to `active` in one write. User-initiated marketplace and system installs, local imports, and bundled sync register new Skills as active and enabled. Metadata refreshes preserve the switch and activation state.

The upgrade migration sets `activationState` to `pending` for `source = 'local' AND source_url IS NULL` and leaves all other rows `active`. Prior builds saved the switch value without recording who set it. Matching legacy Skills require one-time confirmation for inheritance even when the user previously turned them on by hand.

The manual Agent creation wizard supports opt-outs through `disabledSkillIds`. Creation records each opt-out as an explicit `false` in the same transaction as the new Agent. `ResourceCreateResult` reports the created Agent's effective Skill set.

Pending Skills cannot gain new enabling `agent_skill` bindings. For MCP `create_agent`, `skillIds` is the exact selection of globally enabled, active optional Skills. Omitting it uses inheritance, and `[]` enables zero optional Skills. Built-ins follow their global switch. The tool reports the created Agent's effective Skill set.

## Alternatives considered

- Write an `agent_skill` row for every Agent when a Skill is adopted or its global switch changes. This churns rows, misses Agents created later, and can overwrite explicit per-Agent choices on a global toggle.
- Keep the two-level behaviour and document it only. A Skill would keep showing as enabled in Settings while no Agent could use it — the reported state.
- Change the fallback only for `source === 'local'`. System and marketplace installs can also lack a per-Agent row, so the source split would leave the same gap behind an arbitrary boundary.
- Reset the global switch for every legacy adopted Skill. This would suspend recorded `true` bindings for Agents already using the Skill. Preserving the switch and bindings lets those Agents keep using it while inheritance waits for confirmation.

## Consequences

- Agents without a saved opt-in need user confirmation before inheriting an adopted Skill. A saved `true` binding stays effective while the global switch is on.
- A manual creation opt-out persists when a Skill is globally disabled and re-enabled. An explicit `create_agent` selection also records opt-outs for all unselected optional Skills already in the library, including those that are globally disabled at creation.
- The MCP `update_agent` tool uses the effective Skill set as its baseline and applies changes per Skill. When supplied, `skillIds` replaces the optional selection and preserves enabled built-ins.
- Turning a Skill off globally keeps it installed and preserves the stored per-Agent choices for when it is re-enabled.

## Verification

- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` covers adoption and activation in "requires global activation before an Agent can use a skill adopted from the managed library" and adoption path reuse in "reimports an adopted library skill using its %s" (direct path and junction).
- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` covers inheritance and overrides in "enables a globally enabled local skill for an agent that has no per-agent row", "hides a globally disabled local skill and preserves its per-agent opt-out when re-enabled", and "an explicit disabled row for a builtin skill overrides the enabled-by-default fallback".
- Regression — `src/main/data/services/__tests__/AgentService.test.ts` covers inheritance and persistence in "inherits globally enabled skills and keeps a creation opt-out after reactivation".
- Regression — `src/main/ai/mcp/servers/__tests__/agentConfigTools.integration.test.ts` covers omitted, empty, and explicit selections in "applies and reports the skill selection $skillIds", and protects concurrent edits in "rejects a reviewed update if skill bindings change independently before it writes".
- Regression — `src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx` covers the default switches and opt-outs in "starts inherited skills on and retains an explicit opt-out across catalog refreshes" and "keeps builtin skills checked and locked when clearing every optional skill".
- Regression — `src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx` covers the submission and result in "submits a manual skill opt-out and reports the created Agent’s effective skills".
- Regression — `src/shared/ipc/schemas/__tests__/ai.test.ts` covers the create payload in "accepts explicit opt-outs while leaving the remaining skills inherited".
- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` covers pending activation in "requires confirmation for pending inheritance and preserves recorded overrides", "does not create an enabling binding for an unconfirmed skill", "preserves pending and confirmed states through repeated library reconciliation and metadata refresh", and "activates a pending legacy skill when explicitly reimported from the library".
- Regression — `src/main/data/db/__tests__/skillActivationMigration.test.ts` checks the upgrade in "requires confirmation for legacy adoptions while preserving global switches and Agent bindings".
- Regression — `src/main/ai/mcp/servers/__tests__/agentConfigTools.integration.test.ts` covers new and existing bindings in "blocks explicit selection of a pending skill during Agent creation" and "blocks new pending bindings during updates and keeps existing bindings through unrelated edits".
- Regression — `src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx` and `src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx` cover the confirmation action in "confirms a pending Skill even when its saved global switch is already on" and "offers confirmation in place of an on switch for a pending Skill", respectively.
