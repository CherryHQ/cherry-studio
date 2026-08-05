# Local Review

Single-agent review for small changes, or as the explicit fallback when a
runtime cannot launch independent subagents. The canonical size calculation
lives in `SKILL.md` § Route. Reviews the diff and reports confirmed issues with
fix guidance; edits code only when the invocation explicitly authorized fixing.
Follow `SKILL.md` § Interaction and interruption contract; this flow introduces
no additional prompt category.

## Input from SKILL.md

- Review scope (already determined during routing; re-derive with the Step 1
  rules if invoked standalone).
- `AUTHORIZED_FIX`: `true` only when the invocation explicitly granted
  fixing (`fix` modifier or equivalent user wording). Commit and range
  targets are always report-only regardless of the flag.
- `LIMITED_SINGLE_AGENT`: `true` only when a non-small scope was routed here
  because the runtime has no subagent capability. Default `false`.

## References

| File | Purpose |
|------|---------|
| `consumer-review.md` | Consumer review stage (feat-shaped changes) |
| `code-checklist.md` | Code review checklist |
| `doc-checklist.md` | Document review checklist |
| `cherry-review-guidance.md` | Cherry Studio project-specific review boundaries |
| `judgment-matrix.md` | Risk levels, worth-fixing criteria, special rules |
| `checklist-evolution.md` | Checklist update flow and rules |

---

## Step 1: Scope

Determine the diff to review based on `$ARGUMENTS` and working tree state:

- **Empty `$ARGUMENTS`**, **uncommitted changes exist**: scope is
  uncommitted changes only. Fetch with `git diff HEAD` (staged + unstaged
  tracked files). Also check for untracked files with `git status --porcelain`
  (`??` lines) and read their contents for review.
- **Empty `$ARGUMENTS`**, **no uncommitted changes**: find the base branch by
  checking common base branches in order: `main`, `master`. Use the first one
  that exists. Fetch the branch diff:
  ```
  git merge-base origin/{base_branch} HEAD
  git diff <merge-base-sha>
  ```
  Also check for untracked files with `git status --porcelain` (`??` lines).
- **Commit hash** (e.g., `abc123`): validate with `git rev-parse --verify`,
  then `git show`.
- **Commit range** (e.g., `abc123..def456` or `abc123...def456`): validate both
  endpoints. Fetch the diff including both endpoints:
  ```
  git diff A~1..B
  ```
- **File/directory paths**: verify all paths exist on disk, then read file
  contents.

If diff is empty → show usage examples and exit:
`/gh-pr-review` (uncommitted changes or current branch),
`/gh-pr-review a1b2c3d`, `/gh-pr-review a1b2c3d..e4f5g6h`,
`/gh-pr-review src/foo.ts`, `/gh-pr-review 123`,
`/gh-pr-review https://github.com/.../pull/123`.

---

## Step 2: Review

Run the review stages defined in `SKILL.md` § Review Stages in order.

1. **Product Demand gate** — skip silently when the change has no product
   impact. Otherwise: interactive → summarize the product effect and ask for
   the product decision, stopping the entire review if the direction is
   rejected; automated → decide nothing, and carry the product-impact summary
   into Step 4's report.
2. **Consumer review** — only for `feat`-shaped diffs that add or expand
   shared surface. Follow `consumer-review.md`; only surviving surfaces
   continue to the stages below.
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

- **`AUTHORIZED_FIX` = false** (default): report all issues with at-altitude
  fix guidance; edit nothing.
- **`AUTHORIZED_FIX` = true**: auto-fix **low-risk** issues only (a single
  reasonable fix exists), keeping every fix at the defect's altitude per
  `cherry-review-guidance.md` § Fix Recommendation Policy. Medium- and
  high-risk issues report feasible options, key trade-offs, and an optional
  reviewer recommendation — multiple reasonable implementations must be
  surfaced, never silently chosen.

Present a summary of what was reviewed and either the issues fixed/reported
with their fix guidance or "no issues found". If
`LIMITED_SINGLE_AGENT = true`, explicitly state that the scope was non-small
but the runtime had no subagent capability, so the review was single-agent and
did not include independent adversarial verification. In an automated session
with product impact, include the Product Demand summary — impact, direction,
and points needing human confirmation — explicitly marked as awaiting a
product decision, never as approved.

Validation: when fixes were applied, the session is a coding task — run
`pnpm lint`, `pnpm test`, and `pnpm format`, and report their results; a
failure caused by a fix means the fix is reverted or reported as failed.
When nothing was edited, do not run local lint/test/format — state that
existing CI covers the reviewed commit and the result is static review only.

---

## Step 5: Checklist evolution

Review all confirmed issues from this session. If any represent a recurring
pattern not covered by the current checklist, read `checklist-evolution.md` and
record valid candidates as `proposed` in the report. A regular review never
accepts, inserts, or claims to persist checklist rules.
