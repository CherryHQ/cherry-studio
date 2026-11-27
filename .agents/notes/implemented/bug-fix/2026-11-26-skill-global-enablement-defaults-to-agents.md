# Agent Note: Enable globally enabled Skills for Agents by default

Status: implemented

English | [中文](2026-11-26-skill-global-enablement-defaults-to-agents.zh.md)

## Problem

Settings → Skills showed a local Skill as globally enabled, but the Agent skill list reported it as disabled for every Agent. The Skill had no `agent_skill` row, and the projection only defaulted built-in Skills to enabled. The composer Skill menu and the session Skill whitelist both read the Agent-level value, so an Agent could neither see nor call the Skill even though the library switch said it was on.

## Decision

Globally disabled Skills are excluded from the Agent catalog. For a globally enabled Skill, the Agent uses its explicit `agent_skill` value if present and inherits enablement otherwise.

Reconciliation registers newly discovered folders in the managed Skills directory with `isEnabled: false`. The user activates an adopted Skill in Settings → Skills, and Agents without an explicit choice then inherit it. User-initiated marketplace and system installs, local imports, and bundled sync register new Skills as enabled. Metadata refreshes preserve the existing switch.

The manual Agent creation wizard starts with globally enabled optional Skills checked and globally enabled built-ins checked and locked. Unchecking an optional Skill adds it to `disabledSkillIds`. Creation writes an explicit `agent_skill` row with `false` for each opt-out in the same transaction as the new Agent. `ResourceCreateResult` reports the created Agent's effective Skill set.

For the MCP `create_agent` tool, `skillIds` is the exact selection of globally enabled optional Skills. Omitting it inherits all globally enabled Skills, while `[]` enables zero optional Skills. Built-ins follow their global switch. The tool reports the created Agent's effective Skill set.

## Alternatives considered

- Write an `agent_skill` row for every Agent when a Skill is adopted or its global switch changes. This churns rows, misses Agents created later, and can overwrite explicit per-Agent choices on a global toggle.
- Keep the two-level behaviour and document it only. A Skill would keep showing as enabled in Settings while no Agent could use it — the reported state.
- Change the fallback only for `source === 'local'`. System and marketplace installs can also lack a per-Agent row, so the source split would leave the same gap behind an arbitrary boundary.

## Consequences

- An Agent cannot activate an adopted Skill for itself. The user enables it globally in Settings → Skills first.
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
