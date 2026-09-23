---
name: kbd-evolve
description: Use for domain-landscape-first evolution of a KBD project — when the roadmap is empty, exhausted, or you want to recalibrate against external reality rather than follow internal plans. Surveys the external landscape of the project's problem domain, scores improvement opportunities against configurable criteria, and produces a ranked evolution brief that a new phase can consume as its seed.
---

# kbd-evolve

**Domain-landscape-first evolution** for KBD-orchestrated projects.

## When to use vs starting the next planned phase

| Trigger | What it does |
|---------|-------------|
| Planned roadmap has a clear next step | Advance to the next phase in the existing plan directly |
| Unclear what to build next; want external validation | Run `/kbd-evolve` — surveys the domain landscape, scores opportunities, produces a fresh brief |

Use `/kbd-evolve` when the KBD roadmap is empty, exhausted, or you want to
recalibrate against external reality rather than follow internal plans.

## Inputs

```
/kbd-evolve [evolution-name] [--criteria CRITERIA_PROFILE] [--depth DEPTH]
```

| Input | Default | Description |
|-------|---------|-------------|
| `evolution-name` | derived from project + date | Human-readable identifier for cross-session retrieval |
| `--criteria` | `effort-impact` | Criteria profile: `effort-impact`, `strategic`, `risk-adjusted`, `custom` |
| `--depth` | `standard` | Research depth: `quick` (2-3 sources), `standard` (5-8 sources), `deep` (10+ sources) |

## Progress Signals (MANDATORY)

**FIRST tool call of every turn:** Read `.kbd-orchestrator/position-reminder.txt` (if it exists) to get the current phase, step N of T, and next command. If that file is absent, read `.kbd-orchestrator/current-waypoint.json`.

Before any other action, emit to plain response text (BEFORE any tool call):

```
Starting kbd-evolve — <evolution-name or phase> (step N of T)
```

When the evolution brief is written, emit:

```
Completed kbd-evolve — <evolution-name or phase> (step N of T)
```

**How to get N and T (MANDATORY — never estimate):** read
`completion.implementation.completed`/`.total` from `progress.json` via
`implementationCompleted(progress)`/`implementationTotal(progress)`
(`lib/kbd/progress.mjs`), falling back to `current-waypoint.json`'s
`implementationCompleted`/`implementationTotal` when `progress.json` is
absent.

Emit to plain response text — no tool call needed.

## Process (5 stages)

### Stage 1 — Assess current state

Read the current KBD phase state from `.kbd-orchestrator/`:
- Current phase, completed phases, open items
- Project identity (from CLAUDE.md, README.md, package.json, Cargo.toml)
- Known gaps and carry-forwards from the last reflection

Output: a structured **current-state snapshot** (scope, maturity level, open gaps, last 3 reflections).

### Stage 2 — Research landscape

Survey the external domain:

1. **Problem domain taxonomy** — What category is this project in? (realtime fabric, skill orchestration, entity management, etc.)
2. **Competitive/complementary landscape** — What tools, frameworks, and projects exist in this space? What are their strengths?
3. **Emerging patterns** — What trends, new primitives, or architectural patterns are appearing in the ecosystem?
4. **Community signals** — GitHub stars, recent releases, blog posts, RFCs — what is gaining traction?

Research uses: web search, Tavily, firecrawl_research, GitHub search, documentation lookups.
Research depth scales with `--depth` parameter.
See `references/landscape-research.md` for the full search strategy and source weighting.

### Stage 3 — Analyze gaps

Compare current state against the landscape:
- What capabilities does the project lack that peers have?
- What emerging patterns could the project adopt to increase impact?
- What parts of the project are solving solved problems (reinvention risk)?
- What user/developer workflows are underserved?

Output: **gap matrix** — a table of capability gaps with current state, landscape benchmark, and gap severity.

### Stage 4 — Determine evolution

Apply the selected **criteria profile** to rank opportunities.

See `references/criteria.md` for scoring formulas.

Default profile (`effort-impact`):

| Criterion | Weight | Description |
|-----------|--------|-------------|
| User impact | 40% | How many users/workflows does this unblock? |
| Implementation effort | 25% | Estimated complexity (1=trivial, 5=months) — inverted |
| Alignment | 20% | Fits project vision and existing architecture |
| Feasibility | 15% | Dependencies available, team capable, no blockers |

Score = (impact × 0.40) + ((6 - effort) × 0.25) + (alignment × 0.20) + (feasibility × 0.15)

Output: **ranked evolution candidates** — top 3-5 opportunities with scores and rationale.

### Stage 5 — Generate evolution brief

Write the evolution brief to `.kbd-orchestrator/evolution-briefs/<evolution-name>.md`.

Brief format:
```markdown
# Evolution Brief: <name>

**Generated:** <date>
**Project:** <project identity>
**Criteria profile:** <profile used>

## Selected evolution: <winner title>

### Why this, why now
<2-3 sentences of rationale>

### Scope
<What's in, what's out>

### Success criteria
- [ ] <measurable outcome 1>
- [ ] <measurable outcome 2>

### Landscape context
<Key findings from the survey that support this choice>

### Runners-up
| # | Title | Score | Why not selected |
|---|-------|-------|-----------------|

### Recommended next command
Start a new phase named <phase-name>, seeded from
.kbd-orchestrator/evolution-briefs/<evolution-name>.md
```

## Example invocations

```
# Standard: research the landscape and pick the best next evolution
/kbd-evolve

# Named, with strategic criteria profile
/kbd-evolve "q3-capability-gap" --criteria strategic

# Quick scan (good for weekly cadence)
/kbd-evolve --depth quick
```

## State persistence

The evolution brief is saved to `.kbd-orchestrator/evolution-briefs/<name>.md`.
If the surreal-memory MCP is reachable in this project, the evolution cycle is
also recorded as an entity in the knowledge graph under `type: KbdEvolution` —
probe it the same way `lib/kbd/memory.mjs`'s `createMemoryProbe` does
elsewhere in this pack, and skip the write cleanly when it is unreachable.

## Starting the next phase from the brief

After `/kbd-evolve` completes, start a new phase seeded from the brief at
`.kbd-orchestrator/evolution-briefs/<name>.md` — use it as the assessment
input, skipping the assess stage.

## Related skills

- `kbd-process-orchestrator` — Runs the standard KBD lifecycle (assess → plan → execute → reflect)
