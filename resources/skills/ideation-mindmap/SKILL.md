---
name: ideation-mindmap
description: Takes a one-line business or product concept and generates a 6-branch concept mindmap via surreal-memory's generate_ideation_mindmap tool, structuring raw ideas into actionable branches through independent generation, pooling, and critic scoring.
license: MIT
version: '1.0.0'
authors:
  - Prometheus AGS
metadata:
  category: process
  tags: [ideation, mindmap, surreal-memory]
triggers:
  keywords:
    - ideation mindmap
    - concept tree
    - expand idea
    - branch concept
    - business concept branches
    - mindmap my idea
  semantic: >
    User provides a one-line business or product concept and wants it
    structured into branched concept clusters before deeper specification.
---

# /ideation-mindmap

Turns a one-line concept into a 6-branch concept tree using `surreal-memory`'s `generate_ideation_mindmap` tool.

## When to Use

User has a raw idea and wants to see structured branches before committing to a fuller specification.

## MCP Dependency

Requires the `surreal-memory` MCP server to be running. Verify with:

```bash
boss-mini doctor.mjs
```

`surreal-memory` is one of this pack's two resident services (`.claude/rules/docker-services.md`). If it
is unreachable, follow the fallback in Error Handling below rather than blocking.

## Instructions

### Step 1 — Generate at least 3 candidate sets, INDEPENDENTLY

Invoke the `generate_ideation_mindmap` tool from the `surreal-memory` MCP server
**at least three separate times**. Each call is its own dispatch and must receive
**only the topic** — never another call's output, and never a summary of it.

```
# Call 1
generate_ideation_mindmap(topic: "<the one-line concept from $ARGUMENTS>", branches: 6)
# Call 2 — same topic, fresh dispatch, no knowledge of call 1
generate_ideation_mindmap(topic: "<the one-line concept from $ARGUMENTS>", branches: 6)
# Call 3 — same topic, fresh dispatch, no knowledge of calls 1 or 2
generate_ideation_mindmap(topic: "<the one-line concept from $ARGUMENTS>", branches: 6)
```

After each call, record it before moving to the next:

```bash
boss-mini record-dispatch.mjs --session "$SESSION" --set 1 --topic "<concept>"
boss-mini record-dispatch.mjs --session "$SESSION" --set 1 --topic "<concept>" --output <call-1-output-file>
```

Only **after** all sets exist do you pool them (Step 2).

#### Why independence is mechanical, not a prompting style

A single call, or a chain where each call sees the last, is the failure mode this
step exists to avoid.

- **Multi-agent LLM ideation collapses toward agreement.** Chen et al. (2026),
  *Diversity Collapse in Multi-Agent LLM Systems* (arXiv 2604.18005): agents
  exhibit structural coupling and produce redundant ideas **despite architectural
  attempts to diversify**. Telling personas to disagree does not work.
- **Interacting groups underperform independent ones.** Mullen, Johnson & Salas
  (1991), 20 studies / 800+ teams: interactive brainstorming groups are
  significantly *less* productive than nominal groups in both quantity and
  quality, and the gap **grows with group size** (production blocking).

The evidence-backed structure is therefore **independent generation → pool →
judge**, which is what Steps 1–3 implement. Do not add a round-table, a debate
round, or a "have the agents critique each other" step: both findings say that
subtracts value while appearing to add it.

> **Auditable, not merely instructed.** Independence is asserted by inspecting
> what each dispatch received, not by reading this prose — see
> `scripts/assert-independent-dispatch.mjs` and `lib/ideation/independence.mjs`.

### Step 2 — Pool the independent sets, then format

Now — and only now — combine the sets from Step 1.

1. **Merge** all branches from all sets into one pool.
2. **Collapse near-duplicates.** Branches expressing the same idea in different
   words become one entry, and record how many independent sets produced it.
3. **Keep the singletons.** A branch that appeared in only one set is *not* noise
   to be filtered — independent generation exists precisely to surface ideas a
   single pass would miss. Convergence is a useful signal; it is not a ranking.

Annotate each pooled branch with its independent-set count:

```
Branch 3 — <Branch Name>   [3/3 sets]     ← all three converged
Branch 7 — <Branch Name>   [1/3 sets]     ← only one set found this
```

That count is **evidence for the judge**, not a score. A `1/3` branch may be the
best idea in the pool; a `3/3` branch may just be the obvious one. Do not rank by
convergence, and do not drop low-count branches before Step 3.

Present the pooled result as a structured list:

```
Concept: "<original concept>"

Branch 1 — <Branch Name>
  • <concept cluster point 1>
  • <concept cluster point 2>
  • <concept cluster point 3>

Branch 2 — <Branch Name>
  • ...

[... repeat for every pooled branch]
```

Keep each branch to 3–5 sub-bullets. If the MCP result contains more detail, summarize to the most actionable points.

### Step 3 — Score the pool with a critic that did not generate it

Before asking the user to choose, verify independence and hand the pooled
branches to a separate scorer.

```bash
# 1. Independence is a property of what each dispatch RECEIVED, so assert it
#    against the recorded inputs — never by re-reading Step 1's instructions.
boss-mini assert-independent-dispatch.mjs --session "$SESSION" || exit 2
```

```
# 2. Score with a critic on its OWN dispatch.
Task(subagent_type="kbd-idea-critic", prompt=<the pooled branches from Step 2>)
```

The generator must never score its own branches. An agent that just argued for an
idea is the worst-placed one to judge it — the same producer≠judge rule enforced
everywhere else in this pack.

Present the critic's aggregate alongside each branch, **with its
independent-set count from Step 2**:

```
Branch 3 — <Name>   [3/3 sets]  critic 8.2
Branch 7 — <Name>   [1/3 sets]  critic 9.1   ← one set found it; scored highest
```

That pairing is the point. Convergence and quality are different signals, and a
branch only one set produced can still be the best idea in the pool.

> If the critic is unavailable, **do not self-score**. Present the branches with
> `critic: UNAVAILABLE` and say plainly that they are unscored. A self-assigned
> score carries the appearance of review without the substance.

### Step 4 — Present selection prompt

After displaying all branches with their counts and scores, ask:

> Which branches resonate with your vision? You can:
> - **Accept all** — proceed with the full pooled concept tree
> - **Select branches** — name the numbers (e.g., "1, 3, 5") to narrow focus
> - **Refine** — describe what's missing and I'll regenerate

### Step 5 — Handoff

Pass the selected branches (or all of them) as context to whatever the operator does next
with the concept tree.

## Error Handling

| Failure | Response |
|---------|----------|
| `surreal-memory` unreachable | Emit a structured fallback: manually brainstorm 6 branches from the concept text; mark output as `[fallback — surreal-memory unavailable]` |
| A generation call returns < 6 branches | Accept the partial set; the pool draws on the other independent sets. Note the count. |
| Fewer than 3 sets recorded | `assert-independent-dispatch.mjs` REJECTS (exit 2). Do not pool: one or two samples is the single-pass case this design replaces. |
| Concept text is empty | Ask the user: "What is the one-line concept you want to explore?" |

## Example Session

```
User: /ideation-mindmap track competitor pricing changes in real-time

Concept: "track competitor pricing changes in real-time"

Branch 1 — Data Acquisition
  • Web scraping scheduled crawlers (Playwright / Puppeteer)
  • Retailer API integrations (where available)
  • Third-party price intelligence feeds (PriceSpider, Wiser)

Branch 2 — Change Detection
  • Delta comparison engine (previous vs current snapshot)
  • Threshold-based alerting (>5% change triggers)
  • Historical trend indexing for anomaly detection

Branch 3 — Storage & State
  • Time-series database for price history (TimescaleDB / InfluxDB)
  • Product catalog normalization and deduplication
  • Snapshot versioning with audit trail

Branch 4 — Alerting & Delivery
  • Real-time webhook push to Slack / email / PagerDuty
  • Digest reports (daily / weekly) for non-urgent updates
  • Dashboard with competitor comparison views

Branch 5 — Business Rules
  • Competitor selection and weighting logic
  • Price floor / ceiling rules to filter noise
  • Segment-level overrides (geographic, SKU category)

Branch 6 — Deployment & Scale
  • SaaS multi-tenant architecture vs single-tenant
  • Rate limiting and anti-bot evasion strategy
  • Cost model: crawl frequency × product catalog size

Which branches resonate with your vision? ...
```

## Presenting to the user

Every user-facing question goes through `scripts/emit-ui-intent.mjs`:

```bash
boss-mini emit-ui-intent.mjs \
  --title "Which idea to build?" \
  --body  "Three survived scoring." \
  --option "Standup generator" --option "PR summariser"
```

This mini port always renders **Tier 0 text** — the source pack's `ui-surface` skill, which
resolves richer harness tiers and performs a structured round trip, is not part of this repo.
See [references/harness-delivery.md](references/harness-delivery.md) for exactly what that
means and what would need to land first to go further than Tier 0.
