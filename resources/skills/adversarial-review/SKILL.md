---
license: MIT
name: adversarial-review
version: '1.0.0'
description: >
  Isolated, cross-model adversarial review of KBD artifacts and change diffs.
  Dispatches a fresh-context LLM judge over an OpenAI-compatible REST gateway
  (openai-proxy or `liter-llm api`) with an explicit
  mandate to find problems — the model that produced an artifact or change is
  never the model that reviews it. Runs as a pipeline stage inside
  kbd-assess/analyze/plan (artifact mode) and kbd-execute's per-change QA gate
  (diff mode). Findings are severity-bucketed (CRITICAL/WARNING/SUGGESTION)
  and the judge's own report is screened by sycophancy-correction before it
  is surfaced.
authors:
  - 'Prometheus AGS'
model_routing:
  policy_source: ".kbd-orchestrator/project.json → model_policy"
  phases:
    adv-review-preflight: small
    adv-review-packet: small
    adv-review-judge: frontier
  routing_reference: "references/isolation-and-routing.md"
triggers:
  keywords:
    - adversarial review
    - adversarial-review
    - cross-model review
    - llm as judge
    - review this diff adversarially
    - vet this plan
    - vet this assessment
  semantic: >
    Run an isolated find-problems review of a change diff against its spec,
    or of a KBD assessment/analysis/plan artifact against phase goals, using
    a different model than the one that produced the work.
metadata:
  tags: [process, review, quality, llm-as-judge, kbd]
---

# /adversarial-review

Run an **isolated, cross-model, mandate-to-find-problems review** of either a
change diff (post-implementation) or a KBD planning artifact
(pre-implementation).

This is the mini's Node.js port. Every script under `scripts/adversarial-review/`
is a `.mjs` entry point over Node's built-in `fetch` — no `python3`, no `curl`,
no `jq`. The logic lives in `lib/review/`.

## Progress Signals (MANDATORY)

Before building the review packet, emit:

```text
Starting adversarial-review — <mode> <target>
```

After the normalized findings are written, emit:

```text
Completed adversarial-review — <verdict> (<critical>/<warning>/<suggestion>)
```

Use the target and counts from the packet/findings files. Never guess them.

This is a different job from the existing gates:

- A deterministic checklist catches what was thought of in advance.
  Adversarial review hunts for what was **not**.
- `sycophancy-correction` corrects **existing text** for excess agreeableness.
  Adversarial review **generates** a finding set from scratch — and then has
  its own report screened by sycophancy-correction (see Anti-Theater Gate).
- Pre-spec gates (interrogation, coverage scoring) operate **pre-spec**. This
  skill operates on concrete artifacts and diffs.

## Isolation contract

The judge is a **fresh-context API call** to an OpenAI-compatible
`/v1/chat/completions` gateway. It
receives only a review packet — diff or artifact, acceptance criteria or
goals, file tree, constraints — and **never** the producing session's chat
history. Isolation is structural, not honor-system: the session reads only
the normalized findings JSON.

**The producer never grades itself.** The packet records `producer_model`;
dispatch falls back from the `judge` role to the `critic` role when they would
match, and emits a `JUDGE_MODEL_COLLISION` warning when no alternative differs
(see `references/isolation-and-routing.md`). A packet with
`producer_model: unknown` makes that comparison pass trivially, so it is
recorded as `cross_model_check: unverified-producer-unknown` rather than
passed off as a clean cross-model review.

## Modes

### `--mode diff` — post-implementation (kbd-execute QA gate)

Reviews a completed change's diff against its acceptance criteria. Runs
**after** a deterministic checklist gate passes (cheap check first, expensive
judgment second) and **before** archive.

Packet contents: change diff, acceptance criteria (`tasks.md` / OpenSpec spec
/ `verification.md`), repo file tree, blocking constraints from
`.kbd-orchestrator/constraints.md`, `producer_model`.

### `--mode artifact` — pre-implementation (assess / analyze / plan)

Vets a stage artifact before the stage hands off, so downstream stages run
against reviewed inputs:

| Stage | Artifact(s) | Mandate focus |
|---|---|---|
| `assess` | `assessment.md` | missed gaps; claims unsupported by the codebase |
| `analyze` | `analysis.md`, `library-candidates.json` | build-vs-adopt blind spots; uninspected candidates; stale landscape |
| `plan` | `plan.md` | wrong ordering; missing dependencies; untestable or ambiguous change criteria |
| `research` | `report.md`, `<slug>.provenance.md`, `plan.md` of a deep-research package | invented or orphan citations; unanswered sub-questions; contradictions presented as settled; a frontmatter `verification_status` the sidecar does not support |

Packet contents: the artifact(s), phase `goals.md`, prior-stage handoff
summaries, constraints, `producer_model`.

The `research` target is the one artifact target that is not a KBD stage: it
takes `--package <dir>` instead of `--phase`, its `goals` are the run's query,
parameters, and sub-questions (read from `checkpoint.json` and `plan.md`), the
three files travel as separate fields (`research_report`,
`research_provenance`, `research_plan`) so the per-field cap applies to each,
`review_focus` names the failure classes, and `packet.truncation` is always
recorded. A package missing any of the three files is refused with exit 2.

```bash
boss-mini adversarial-review/build-review-packet.mjs --mode artifact --target research --package ~/.prometheus/research/<package_id> --out review/packet.json
boss-mini adversarial-review/dispatch-judge.mjs       --mode artifact --packet review/packet.json --out review/findings.json
```

### `--mode skill` / `--mode agent` — generated artifacts (creation gate)

Reviews something a **generator** just produced, so a skill or agent is judged
by a model that did not write it. Unlike the two modes above, `--target` is a
**filesystem path** and `--phase` is optional — a creator often runs outside any
KBD phase, and requiring one would make the gate unreachable where generation
actually happens.

| Mode | Target | Packet contents |
|---|---|---|
| `skill` | generated skill dir | `SKILL.md`, parsed frontmatter, script inventory, cross-reference map, validator output, original intent |
| `agent` | generated Cargo workspace | `agent.toml`, `system_prompt.md`, workspace members with per-crate purpose, `mcp_servers`, `cargo check` result, original intent |

### `--mode decision` — an idea, before committing to it

Reviews a **decision someone is about to make**, not code. `--target` is a
single **file**, not a directory.

The mandate's core instruction is that the judge **must not score novelty**.
Si, Hashimoto & Yang (2025) had 43 experts spend 100+ hours each *executing*
randomly-assigned ideas: LLM ideas rated more novel before execution, then
dropped on every metric after it, and the ranking flipped. A pre-execution
novelty rating is evidence pointing the wrong way. The judge rates whether the
reasoning survives contact with reality.

The packet parses the decision into `decision` / `assumptions` / `falsifier` and
records `missing_fields`. **A decision stating no falsifier cannot be wrong about
anything, which is itself the defect** — the packet surfaces that structurally,
without spending a judge call. It also carries `prior_decisions` (via `pk
search`), so a decision that contradicts an earlier one is visible to the judge.

```bash
boss-mini adversarial-review/build-review-packet.mjs --mode decision --target decision.md --intent intent.md --out packet.json
boss-mini adversarial-review/dispatch-judge.mjs       --mode decision --packet packet.json --out findings.json
```

Decision-mode findings additionally require `confidence` (0–100),
`what_would_change_this`, and a non-empty `disconfirming` array — see
[Output contract](#output-contract). These are the automation-bias
countermeasures: a review that cannot say what would change its mind is
manufacturing certainty.

**Ordering matters more than the analysis.** For personal or hard-to-reverse
decisions, run `commit-before-reveal.mjs record` first. Showing someone the
analysis and then asking what they think produces agreement, not judgement —
confidence in AI predicts whether users scrutinise it at all. The gate exits 2
and writes no analysis until a judgement is on record.

Decisions and their outcomes persist via `decision-log.mjs` (`record` /
`outcome` / `revisit`), so a later decision can be checked against what actually
happened.

```bash
boss-mini adversarial-review/build-review-packet.mjs --mode skill --target dist/my-skill --intent spec.md --out packet.json
boss-mini adversarial-review/build-review-packet.mjs --mode agent --target ./my-agent   --intent spec.md --out packet.json
```

Both are **manifest-level**: they record what each file *is* and does, never its
body. A generated workspace is several crates of Rust that would not fit a judge's
context and would bury the signal if it did. The contract is enforced, not merely
intended — a packet whose descriptive fields contain shell-function or Rust
syntax is refused with **exit 2** and no packet is written.

**Truncation is always recorded.** Every field is capped
(`PACKET_FIELD_CAP_BYTES`, default 40000). A clipped field carries an inline
`[TRUNCATED …]` marker, and `packet.truncation` reports the cap and per-field
byte counts. The block is present even when nothing was cut, so "nothing was
dropped" is distinguishable from "this packet predates truncation recording" —
otherwise a judge could return `PASS` on material it never received.

`--intent` supplies what the artifact was *asked* to be. Without it the judge can
only assess internal consistency, never whether the result answers the request;
the packet warns when it is missing.

## Workflow

```
1. preflight   scripts/adversarial-review/preflight-models.mjs          [MODEL_ROUTING] class=small
2. packet      scripts/adversarial-review/build-review-packet.mjs       [MODEL_ROUTING] class=small
3. judge       scripts/adversarial-review/dispatch-judge.mjs            [MODEL_ROUTING] class=frontier
4. gate        scripts/adversarial-review/check-findings-sycophancy.mjs (anti-theater screen)
5. surface     findings JSON → caller gate semantics
```

Concretely:

```bash
# 0. Load the gateway credential and declare the producer.
#    KBD_PRODUCER_MODEL is REQUIRED for the guarantee this skill exists to make.
#    The judge's collision check compares candidate != producer, so an unknown
#    producer makes it pass trivially.
#
#    Do NOT write ${KBD_PRODUCER_MODEL:-claude-opus-5}. A default does not fix
#    the problem, it hides it: the check would then compare the judge against
#    a guess, pass, and record verified-distinct for a comparison that never
#    happened. Export the real value, or let the guard refuse.
set -a; . ~/.prometheus/kbd/secrets.env 2>/dev/null || true; set +a
export KBD_PRODUCER_MODEL="claude-opus-5"   # ← the model running THIS session

# 1. Preflight (cached 24h at .kbd-orchestrator/model-preflight.json)
#    Reports the gateway, the model per role, and WHICH config layer supplied it.
boss-mini adversarial-review/preflight-models.mjs

# 2. Build the packet
boss-mini adversarial-review/build-review-packet.mjs \
  --mode diff --phase "$PHASE" --target "$CHANGE_ID" \
  --out ".kbd-orchestrator/phases/$PHASE/review/$CHANGE_ID/packet.json"

# 3. Dispatch the judge
boss-mini adversarial-review/dispatch-judge.mjs \
  --mode diff \
  --packet ".kbd-orchestrator/phases/$PHASE/review/$CHANGE_ID/packet.json" \
  --out    ".kbd-orchestrator/phases/$PHASE/review/$CHANGE_ID/findings.json"

# 4. Anti-theater gate (exit 2 = rejected: re-dispatch once with feedback)
boss-mini adversarial-review/check-findings-sycophancy.mjs \
  --findings ".kbd-orchestrator/phases/$PHASE/review/$CHANGE_ID/findings.json" \
  --counter-key "adv-review-$CHANGE_ID"
```

Artifact mode replaces `--target "$CHANGE_ID"` with `--target assess|analyze|plan`.

## Dispatch fallback chain

Warn, never silently degrade, never block the pipeline:

1. **REST gateway** — an OpenAI-compatible `POST /v1/chat/completions` at the
   resolved gateway (openai-proxy on `:8181`, or `liter-llm api` on `:4000`).
   Full isolation, true cross-model. `dispatch-judge.mjs` exit 0, and the
   findings record `isolation_mode: rest-gateway:<url>` plus `cross_model_check`.
2. **Harness-native fresh-context subagent** — when no gateway is reachable
   (`dispatch-judge.mjs` exit 3), the calling session dispatches a subagent
   (Agent tool / equivalent) whose prompt is exactly: the mode's mandate file
   + the packet JSON. Nothing else. Findings are logged with
   `"isolation_mode": "harness-native"` — a weaker guarantee (same model
   family), stated, not hidden.
3. **Pending review** (exit 4) — no judge available at all. Write a local
   `pending_review` receipt for the cumulative Git diff. Development may
   continue; final local certification requires a completed independent review
   receipt or an SSH-signed waiver.

## Output contract

`findings.json` (schema: `skills/adversarial-review/assets/schemas/findings.schema.json`):

```json
{
  "mode": "diff",
  "verdict": "BLOCK",
  "judge_model": "openai/gpt-4o",
  "isolation_mode": "rest-gateway:http://localhost:8181/v1",
  "producer_model": "claude-opus-5",
  "cross_model_check": "verified-distinct",
  "findings": [
    {
      "severity": "CRITICAL",
      "file": "src/auth/session.rs",
      "line": 142,
      "claim": "Token expiry is checked before refresh, allowing a replay window",
      "evidence": "diff hunk @@ -138,+142 removes the pre-refresh revocation check required by AC-3",
      "suggested_fix": "Re-check revocation after refresh, before issuing the new token"
    }
  ]
}
```

Severity semantics:

| Severity | Diff mode | Artifact mode |
|---|---|---|
| `CRITICAL` | record a KBD blocker and set certification `blocked`; fix, then re-run the deterministic checklist **and** adversarial-review | revise artifact and re-vet (max 2 rounds, then accept with an "Unresolved review findings" section appended so the next stage sees them) |
| `WARNING` | logged in the change's review dir; proceed to archive | appended to the stage handoff summary |
| `SUGGESTION` | informational | informational |

`verdict` is `BLOCK` iff at least one CRITICAL finding exists.

## Anti-theater gate

The judge's findings report is itself screened through sycophancy-correction
(`scripts/adversarial-review/check-findings-sycophancy.mjs`, which spawns the
`sycophancy-correction` binary over a stdio MCP JSON-RPC session): a report
scoring ≥ 0.4 or matching high/critical sycophancy patterns —
e.g. zero findings on a large multi-file diff wrapped in hedged praise — is
**rejected**, and the judge is re-dispatched once with the rejection feedback
appended to its mandate (`dispatch-judge.mjs --feedback <file>`). A soft cap
then accepts the next report with a logged warning, mirroring the retry-loop gate.
When the sycophancy binary is absent the gate degrades gracefully (exit 0,
warning) — it never blocks the chain.

### The rejection cap is yours to set

The cap defaults to **2** and is overridable via `PROMETHEUS_ADV_REJECT_CAP`:

```bash
PROMETHEUS_ADV_REJECT_CAP=4 boss-mini adversarial-review/check-findings-sycophancy.mjs --findings f.json
```

| Value | Effect |
|---|---|
| unset | cap 2 (default) |
| 1–5 | honoured |
| above 5 | **exit 1** — refused, never clamped |
| 0, negative, non-numeric | **exit 1** — refused, never silently defaulted |

A value above the ceiling is an error rather than being clamped down, because a
silently-lowered cap would leave you believing a bound was in force that was not.

Every run records the cap in the findings artifact, so a stored review is
auditable after the fact:

```json
"sycophancy_screen": { "reject_cap": 4, "cap_overridden": true, "cap_default": 2 }
```

> This cap bounds how many times an **evasive judge report** is sent back. The
> creators' 2-round retry cap — how many times an **artifact** is re-reviewed
> after CRITICAL findings — is a separate bound owned by
> `review-retry-loop.mjs` and is unaffected by this variable.

## Skip rules

- No file-count or documentation-only heuristic exists in any mode.
- Diff mode reviews the cumulative Git diff since the last accepted local
  review receipt, so a sequence of small commits cannot evade review.
- `--skip-qa` and `--skip-adversarial-review` are independent. Either records
  `pending_review`; neither satisfies final local certification without an
  SSH-signed waiver.

## Multi-model preflight

`scripts/adversarial-review/preflight-models.mjs` runs at KBD method start
(kbd-assess step 0) and lazily before any dispatch without a fresh cache. It:

1. Detects provider keys from the canonical env vars.
2. Resolves each role (`judge` / `critic` / `generator`) against
   `~/.prometheus/kbd/models.toml` `[roles]`, then reports which config layer
   supplied it. Two files own this, and neither is a script:
   - `~/.prometheus/kbd/models.toml` — role → model NAME (KBD owns)
   - `~/.config/liter-llm/liter-llm-proxy.toml` — NAME → provider + base_url +
     `${KEY}` (liter-llm owns)

   Repair or extend both by hand, or with `/liter-llm-bridge configure` when
   that skill is available. It merges and never clobbers.
3. Verifies ≥ 2 distinct **dispatchable** models exist (so judge ≠ producer is
   always possible). Exactly 1 → `status: degraded`. It also reports
   `config_defects` with named defects when the liter-llm config exists but
   cannot serve a request — missing `[general] master_key` (401 on everything)
   or a localhost `base_url` with no `[security] outbound_policy` (`deny_private`
   blocks loopback).
4. When **no** keys are found: ask the user which providers to configure
   and instruct them to export the key. **This skill never collects, stores,
   or writes API keys** — config files hold aliases only; keys stay in the
   environment.

Cache: `.kbd-orchestrator/model-preflight.json` — re-run on `--force`,
config change, or age > 24 h.

## Mobile portability classification (`classify-mobile-execution.mjs`)

Not part of the review pipeline above — a standalone tool that assigns every
script-bearing skill in `skills/` a mobile execution verdict (E0/E1/E2/R),
derived from what its scripts actually invoke, not hand-typed:

```bash
boss-mini adversarial-review/classify-mobile-execution.mjs --out .kbd-orchestrator/phases/mobile-skill-portability/mobile-classification.json
boss-mini adversarial-review/classify-mobile-execution.mjs --check
```

## Escalation — Party Mode is not built here

Multi-persona debate is **deliberately out of scope**. A single isolated
adversarial reviewer captures most of the value, while fixed-round
multi-agent debate can launder confidence into consensus — the exact failure
mode sycophancy-correction exists to fight. Reserve multi-persona escalation
for pre-implementation, hard-to-reverse decisions.

## References

- `references/output-contract.md` — findings schema and gate semantics
- `references/isolation-and-routing.md` — fresh-context judging rationale,
  model resolution, collision handling, fallback chain, preflight contract
- `references/model-configuration.md` — how the judge finds a model that is
  not the producer, and how to point it at any provider you have
