---
name: agent-team-models
description: "Discover configured models and choose explicit capability, strength and cost policies at team, role, skill and task levels. Use when selecting models or controlling an agent team budget; use agent-team-creator for role discovery. Unknown prices and capabilities remain unknown. Do not use for role selection (see agent-team-creator)."
license: MIT
compatibility: Requires Node.js 22 or newer. Git is optional for handoff snapshots. Model gateways, memory services and native harness CLIs are optional and separately configured.
metadata:
  version: "1.0.0"
  tags: "agents, teams, orchestration, coding"
---

# Agent Team Models

Use the companion `agent-team-creator` compiled runtime and read its
`references/models-memory.md`. Discover the currently configured provider/model
identifiers; do not infer availability, strength or price from a model name.

Ask for missing constraints in task terms: difficult reasoning, routine
implementation, mechanical edits, tools, vision, context size or cost. Reuse
existing preferences. Explain the three policy tiers as operator labels:
`hard` for difficult reasoning/review, `medium` for routine implementation, and
`low` for bounded mechanical work. They do not guarantee benchmark performance.

```text
node <agent-team-creator>/scripts/cli.mjs models-discover --input discovery.json
node <agent-team-creator>/scripts/cli.mjs models-select --input selection.json
```

Discovery supports a configured OpenAI-compatible gateway (including liter-llm),
or the explicit verified UAR/BossFang discovery endpoint. Supply credentials by
environment variable reference. A successful model listing does not prove a
successful inference. Offline operator-declared catalogs also work and are
labeled as declarations.

Map gateway aliases explicitly to liter-llm catalog provider/model identities.
Keep catalog provenance, freshness and per-token→per-million conversion. Annotate
tiers explicitly. Missing capability or price data cannot satisfy a requirement
or price ceiling; report no match instead of quietly relaxing constraints.

Policy order is team → role → requested skills in explicit order → task.
Scalar values override; required capabilities accumulate. Explain the effective
policy and why the selected model qualifies. This is a configured policy order,
not a security boundary: a task override may intentionally change a budget.
Stale prices are estimates, not a guarantee of current provider charges.

Save the concrete chosen ID in the role’s `modelPolicy.model` (or task policy
for a task-specific invocation) through a reviewed manifest/state update.
Re-run selection when the skills or task change. Skill policies influence
selection; they do not mutate a skill’s frontmatter or force every harness to
support per-skill model switching.

Read the selected harness’s native reference before binding it. Kimi has no
role frontmatter model setting; DeepSeek team members lack a verified per-member
override. Use supported invocation/global controls or report the limitation.
Never add an invented model flag. Report policy, selected ID, unknown metadata,
price age, and whether native application has actually been verified.
