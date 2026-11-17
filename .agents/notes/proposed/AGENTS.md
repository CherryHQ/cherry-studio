# AGENTS.md — Proposed Agent Notes

A proposed Agent Note is an approved target, not permission to start implementation automatically. For substantial feature, architecture, process, or simplification work, the current Spec PR head must have an explicit human `APPROVED` review before an implementation layer starts.

Implementation PRs may stack on the unmerged Spec branch. Each layer links the Spec PR and declares the `AC` IDs it covers. A material change to behavior, ownership, acceptance criteria, alternatives, or risks belongs on the Spec branch, invalidates prior approval, and must be approved again before implementation continues.

Before moving a Spec, inspect `gh stack view --json` and the actual verification on every downstack implementation PR. Intermediate layers keep the triplet here. Only the final layer whose cumulative evidence covers every approved `AC` moves it to `implemented/`; branch position alone is insufficient.

Discussion edits and `CHANGES_REQUESTED` do not reject a Spec. Only an explicit human decision may move it to `rejected/`.
