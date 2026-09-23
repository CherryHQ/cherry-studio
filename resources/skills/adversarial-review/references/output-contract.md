# Output Contract

Canonical schema: [`../assets/schemas/findings.schema.json`](../assets/schemas/findings.schema.json).

## Findings document

```json
{
  "mode": "diff | artifact",
  "verdict": "PASS | BLOCK",
  "judge_model": "provider/model-id",
  "isolation_mode": "rest-gateway:<url> | harness-native",
  "producer_model": "<model whose work was reviewed>",
  "cross_model_check": "verified-distinct | same-model-collision | unverified-producer-unknown",
  "findings": [
    {
      "severity": "CRITICAL | WARNING | SUGGESTION",
      "file": "path or artifact name",
      "line": 42,
      "claim": "one-sentence defect statement",
      "evidence": "hunk / criterion / quote proving the claim",
      "suggested_fix": "optional concrete fix"
    }
  ]
}
```

- `verdict` is derived, never judged: `BLOCK` iff ≥1 `CRITICAL` finding.
  `dispatch-judge.mjs` recomputes it after shape-checking
  (`lib/review/judge-findings.mjs`'s `normalizeFindings`), so a judge cannot
  hand-wave a `PASS` over its own CRITICAL findings.
- Findings missing `claim` or `evidence`, or with an unknown severity, are
  dropped during normalization — unsupported assertions never reach the gate.
- `isolation_mode` is diagnostic honesty: `harness-native` marks reviews run
  through the fallback subagent (same model family as the session), so later
  audits can weight them accordingly.

## Gate semantics per caller

### Diff mode (kbd-execute Per-Change QA Gate)

| Verdict / severity | Effect |
|---|---|
| `BLOCK` (any CRITICAL) | `certification: BLOCKED` in `progress.json`; fix the change, then re-run the deterministic checklist **and** `adversarial-review` before archive |
| WARNING | persisted in `.kbd-orchestrator/phases/<phase>/review/<change-id>/`; archive proceeds |
| SUGGESTION | informational only |

### Artifact mode (kbd-assess / kbd-analyze / kbd-plan)

| Verdict / severity | Effect |
|---|---|
| `BLOCK` (any CRITICAL) | revise the artifact, re-vet; max 2 rounds (`lib/review/retry-loop.mjs`'s `evaluateRetryState`), then accept with an **"Unresolved review findings"** section appended to the artifact so the next stage inherits them explicitly |
| WARNING | appended to the stage handoff summary |
| SUGGESTION | informational only |

The bounded revise loop is deliberate: like the sycophancy gate's 2-rejection
soft cap, it prevents an infinite loop while guaranteeing the failure is
**visible** (never silently accepted).

### Artifact mode, `research` target (deep-research driver, between stage 09 and 10)

The caller records the outcome in `checkpoint.json` (`review`, `blocked_review`)
and the `<slug>.provenance.md` sidecar; the export stage always exports so the
run is auditable.

| Outcome | Effect |
|---|---|
| `BLOCK` (any CRITICAL) | sidecar `Verification: BLOCKED` with `Blocked: adversarial review: N CRITICAL finding(s)`; report frontmatter `verification_status` lowered to `partial`; package exports with `verification_status: partial` |
| WARNING | appended to the sidecar under `Review warnings`; verdict unchanged |
| SUGGESTION | kept in `review/findings.json` only |
| judge unavailable (no gateway, dispatch exit 3) | sidecar `Adversarial review: blocked: judge unavailable`; frontmatter lowered to `partial`; the package label cannot be `verified` |
| review refused (a prior verification artifact is missing or invalid at review time) | no judge call; sidecar records the refusal; frontmatter lowered to `partial` |

`review/packet.json` and `review/findings.json` are written inside the
package. Verification and review never run in one dispatch: the judge only
ever sees a report whose sources an earlier verification stage already scored.

## Severity calibration

- `CRITICAL` — proceeding uncorrected produces defective output: shipped bug,
  violated acceptance criterion, breached blocking constraint, or (artifact
  mode) a downstream stage building on a wrong premise.
- `WARNING` — real risk or quality problem the team should see; not blocking.
- `SUGGESTION` — improvement; ignorable without consequence.

This matches the OpenSpec reporting convention already used across the repo —
this skill is a new producer of an existing shape, not a new concept.
