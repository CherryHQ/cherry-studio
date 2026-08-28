# Local Review

Single-agent review for a small scope, or as the explicit fallback when a
runtime cannot launch independent subagents. Scope and `SMALL_SCOPE` are
derived by `SKILL.md` § Scope derivation. Reviews the diff and reports
confirmed issues with fix guidance; edits code only when the invocation
explicitly authorized fixing.
Follow `SKILL.md` § Interaction and interruption contract; this flow introduces
no additional prompt category.

## Input from SKILL.md

- `REVIEW_TARGET`, the resolved review scope, and `SMALL_SCOPE`, all derived
  by `SKILL.md` § Scope derivation.
- `AUTHORIZED_FIX`: `true` only when the invocation explicitly granted
  fixing (`fix` modifier or equivalent user wording). Commit and range
  targets are always report-only regardless of the flag.
- `LIMITED_SINGLE_AGENT`: `true` only when a non-small scope was routed here
  because the runtime has no subagent capability. Default `false`.

## References

| File | Purpose |
|------|---------|
| `consumer-review.md` | Consumer review stage (changes adding/expanding shared surface) |
| `code-checklist.md` | Code review checklist |
| `doc-checklist.md` | Document review checklist |
| `cherry-review-guidance.md` | Cherry Studio project-specific review boundaries |
| `judgment-matrix.md` | Risk levels, worth-fixing criteria, special rules |
| `checklist-evolution.md` | Checklist update flow and rules |

---

## Step 1: Scope

Scope, resolved-scope emptiness, and `SMALL_SCOPE` are owned by `SKILL.md`
§ Scope derivation. The router already resolved them; when invoked
standalone, derive them with those rules and print its usage examples if the
resolved scope is empty. Do not restate the derivation here.

---

## Step 2: Review

Run the review stages defined in `SKILL.md` § Review Stages in order.

1. **Product Demand gate** — follow `SKILL.md` § Review Stages, stage 1 for
   the skip test and mode rules: skip silently only after inspecting the
   semantics the change expresses or constrains, never from its change type;
   interactive is the default (ask the current user for the product decision
   and stop the whole review if the direction is rejected), and record-only
   automated behavior applies only when the invocation or workflow context
   explicitly identifies an automated run, carrying the product-impact
   summary into Step 4's report. Skip this step when the PR wrapper already
   ran the gate.
2. **Consumer review** — whenever the diff adds or expands shared surface,
   judged by diff semantics rather than change label. Follow
   `consumer-review.md`; only surviving surfaces continue to the stages below.
3. **Architecture-First, Implementation, Style** — as follows.

Review the diff. Apply `code-checklist.md` to code files,
`doc-checklist.md` to documentation files. Apply `cherry-review-guidance.md` to
code, mixed, Cherry architecture documentation, and project-skill changes:
first read the docs its "Mandatory Baseline Docs" section requires for the
touched processes, then load only the on-demand references it routes to.
Review architecture-first — settle placement, ownership, and
abstraction-integrity findings against those docs before line-level detail;
doc violations are Warning minimum. For React component changes, also consult
`vercel-react-best-practices` skill for detailed performance patterns. When
changed lines depend on surrounding context, read the relevant sections or
related definitions as needed. Untracked files have no diff — review their
full contents as new code.

If the branch has an associated GitHub PR, inspect its checks with `gh pr
checks` and include failing or pending CI in the review. Do not run `pnpm lint`,
`pnpm test`, or `pnpm format` locally during review. If no associated PR exists,
state that CI validation is unavailable and keep the result explicitly limited
to static review.

For each issue found:
- Provide a code citation (file:line + snippet) from the current tree.
- Self-verify by re-reading the code — confirm or withdraw.
- If a cited path/line no longer exists, locate the correct file/path via `git diff --name-only` or file search before reporting.

**Output rule**: only present the final confirmed issues to the user. Do not
output analysis process, exclusion reasoning, or issues that were considered
but ruled out.

---

## Step 3: Filter

Consult `judgment-matrix.md` for risk level assessment, worth-fixing criteria,
and special rules. Discard issues that are not worth reporting.

If no issues remain after filtering, keep an empty issue list and continue to
Step 4 so every mandatory disclosure is still reported. Step 5 may be skipped
because there are no confirmed issues to evolve into checklist candidates.

---

## Step 4: Fix and report

Do not ask the user which issues to fix.

Apply `judgment-matrix.md` § Handling by Risk Level, which owns what each risk
level permits under `AUTHORIZED_FIX`. Keep every applied fix at the defect's
altitude per `cherry-review-guidance.md` § Fix Recommendation Policy.

Present a summary of what was reviewed and either the issues fixed/reported
with their fix guidance or "no issues found". If
`LIMITED_SINGLE_AGENT = true`, explicitly state that the scope was non-small
but the runtime had no subagent capability, so the review was single-agent and
did not include independent adversarial verification. In an automated session
with product impact, include the Product Demand summary — impact, direction,
and points needing human confirmation — explicitly marked as awaiting a
product decision, never as approved.

Validation: when fixes were applied, the session is a coding task — run the
validation selected per `SKILL.md` § Validation after applied fixes and report
the results; a failure caused by a fix means the fix is reverted or reported
as failed.

When nothing was edited, do not run local lint/test/format and state the CI
baseline recorded in Step 2, matching it: with an associated PR, existing CI
covers the reviewed commit but not any unpushed change; with no associated PR
— file, commit, or local-branch review — CI validation is unavailable and the
result is static review only. Never claim CI coverage the target does not have.

---

## Step 5: Checklist evolution

Review all confirmed issues from this session. If any represent a recurring
pattern not covered by the current checklist, read `checklist-evolution.md` and
record valid candidates as `proposed` in the report. A regular review never
accepts, inserts, or claims to persist checklist rules.
