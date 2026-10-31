# Agent Note: Bidirectional website documentation synchronization

Status: proposed

English | [中文](2026-10-31-website-docs-bidirectional-sync.zh.md)

## Problem

Desktop feature changes and their public documentation live in separate repositories. Contributors need to update both in one Cherry Studio PR while retaining the ability to edit documentation directly in the website repository. A one-way mirror would discard one of those workflows; copying the latest directory over its peer would lose concurrent edits.

The website owns a Fumadocs static-export application with local Markdown, assets, navigation, and content configuration. Its header imports website navigation, translations, and assets. Its scheduled reference-data job also edits documentation. Moving the complete application would couple desktop development to website UI and release tooling unnecessarily.

This is a new process decision. The [documentation governance decision](../../implemented/process/2026-08-18-docs-governance-and-spec-workflow.md) explicitly deferred website projection; this proposal defines the separate public-content workflow without replacing its development-documentation rules. No synchronization or content import has been implemented by this Spec.

## Proposal

### Content boundary and initial import

Both repositories remain editable. Add `website-docs/` to Cherry Studio and map these paths without changing relative links, public article URLs, or locale layouts:

| Cherry Studio | Website |
| --- | --- |
| `website-docs/content/` | `docs-site/content/` |
| `website-docs/locales.json` | `docs-site/locales.json` |
| `website-docs/page-aliases.json` | `docs-site/page-aliases.json` |
| `website-docs/shadowed-baseline.json` | `docs-site/shadowed-baseline.json` |

All tracked content inside that mapping participates, including desktop and mobile guides, images, attachments, per-language `SUMMARY.md`, and model reference pages. Website rendering code, dependencies, generated output, `docs-site/public/models-search/`, deployment configuration, and shared website components stay website-owned. A local `website-docs/README.md` and `AGENTS.md` explain editing and the boundary; neither synchronizes. Existing `docs/` remains development documentation.

Bootstrap from one recorded website `main` commit, then verify byte-identical mapped files and initialize a shared baseline before enabling either direction. Recheck website `main` at activation so changes made during import become a subsequent reconciliation. Do not initialize an empty destination as a set of intended deletions.

### Reconciliation and conflicts

Run one coordinator in Cherry Studio. A mapped-path push to either protected `main` requests reconciliation; the website notifies the coordinator through `repository_dispatch`. Manual dispatch and a scheduled reconciliation recover missed notifications. Notifications request a fresh comparison of both current heads; they do not authorize arbitrary repositories, paths, or revisions from event payloads.

The coordinator records the last equal pair of commit SHAs and mapped-tree digest in a dedicated `docs-sync-state` branch. Both recorded commits must remain retrievable. Serialize coordinator runs with cancellation disabled and update state with a compare-and-swap push. State updates never push directly to either `main`.

For each run, read both current heads and compare their mapped content against the last equal baseline. Use Git's existing three-way merge machinery for text, without whitespace normalization or a custom merge algorithm. Preserve independent changes, identical edits, additions, and unambiguous deletions. Treat a rename as deletion plus addition. Conflicting text, different binary replacements, delete-versus-edit, and incompatible file types block the entire content batch; do not choose a preferred side, partially propagate the batch, or publish conflict markers. Report conflicting paths and all three revisions in the run summary. A maintainer commits the resolved content for conflicting paths through normal PRs in both repositories until those paths agree; subsequent reconciliation handles the remaining mergeable changes in the batch.

If the merged content differs from one head, open or refresh one bot-owned synchronization PR in that repository. If independent changes require updates on both sides, create one PR per repository for the same reconciliation. Each PR identifies the baseline, observed source and destination SHAs, and mapped-tree digest. Never auto-merge these PRs. An existing manually edited synchronization branch is left for its maintainer rather than overwritten. Closing a synchronization PR without merging pauses that direction until an explicit manual resume.

Advance the shared baseline only after current mapped trees are equal, including after both PRs merge. A partial merge, conflict, cancelled run, or failed check retains the old baseline. Compare content rather than ignoring all bot commits: bot updates can contain new reference data that must propagate. Equal content creates no PR, so importing a synchronization commit does not bounce it back.

### Changes while a PR is open

Changes arriving after a comparison remain eligible for the next run. Before creating or refreshing a synchronization PR, refetch both heads and abandon a stale plan. A PR check binds the plan to its observed revisions and fails when new mapped changes invalidate it; rerun reconciliation and checks before merging. Do not replace a newer PR with an older event or acknowledge unseen content as synchronized. Changes outside the mapping do not invalidate an otherwise current content plan.

### Editing, validation, and publication

Contributors can edit either repository normally. Cherry Studio feature PRs include the corresponding `website-docs/` changes. Provide local preview and CI validation using a recorded website renderer revision in an isolated checkout; overlay the candidate content there without modifying another working checkout. Use the website's pinned toolchain and existing generation, link, navigation, and build checks. Updating the renderer revision is an explicit reviewed change. Fork PR validation has no cross-repository write credentials and cannot invoke privileged synchronization.

The existing website pipeline still builds and deploys its complete artifact after a website PR merges. A desktop merge requests a documentation PR, not production deployment. Reviewers control when documentation for an unreleased feature goes live by merging its website synchronization PR. Website edits can already be public before their return PR merges into Cherry Studio; the repositories provide eventual consistency, not an atomic cross-repository release.

Keep the website's scheduled reference-data writer in place. Its mapped content changes synchronize back; its website-only search output remains local. Explicitly request reconciliation when an automation token does not emit a triggering push event. Inspect the existing release dispatch to the old documentation repository separately: do not silently retarget an unrelated download-version event as part of content synchronization.

### Credentials and rollout

Use a GitHub App installed on the two fixed repositories with only the permissions needed to read revisions, write bot synchronization branches/state, open PRs, and dispatch reconciliation. Bot-created PRs must run the normal required checks; do not depend on the default `GITHUB_TOKEN` to trigger them. Follow each repository's commit signing, sign-off, and branch protection rules. Missing installation access or permissions is a reported failure, never a successful checkpoint.

Roll out import and baseline first, dry-run reconciliation in both directions next, then enable PR creation after the approved checks pass. Dry-run outputs identify source/destination SHAs, changed paths, conflicts, and proposed PR actions without repository writes. Disabling notifications and the coordinator stops synchronization while preserving both copies and the last baseline. Re-enabling recomputes from that baseline; it never reimports over either tree.

## Alternatives considered

- **One editable source.** Simpler, but does not satisfy editing in both repositories.
- **Move the entire website or docs application.** Would remove some synchronization, but expands ownership to website rendering and deployment; its current shared-header dependencies remain relevant.
- **Submodule or subtree as the contributor interface.** Adds cross-repository Git operations to routine feature PRs without removing concurrent-edit and publication decisions.
- **Two independent copy jobs or last-writer-wins.** Can erase concurrent text, assets, and deletions, and can repeatedly echo changes.
- **Automatic merge and deployment of synchronization PRs.** Removes the review point that controls conflicts and publication of unreleased functionality.

## Acceptance criteria

- AC1 — Bootstrap produces byte-identical content for every mapped path from a recorded website commit, preserves current article URLs, and leaves website-only and existing development files outside the synchronized set (verification: docs gate; owner: implementation author)
- AC2 — An edit from either repository, including an image, navigation addition, or deletion, creates the corresponding reviewable PR in its peer and propagates after merge without direct writes to either main branch (verification: GitHub integration; owner: implementation author)
- AC3 — Concurrent independent text changes survive together; conflicting text, binary replacements, delete-versus-edit, and type conflicts report the original revisions and paths without losing either side or publishing a partial batch (verification: unit; owner: implementation author)
- AC4 — Duplicate, delayed, and bot-originated events converge without duplicate PRs or synchronization loops, while new scheduled reference content still propagates (verification: unit and GitHub integration; owner: implementation author)
- AC5 — Mapped edits arriving during an open PR invalidate stale plans and remain in subsequent reconciliation; manually edited bot branches are preserved and a deliberately closed PR stays paused until manual resume (verification: unit and GitHub integration; owner: implementation author)
- AC6 — A failed dispatch, missing permission, conflict, interrupted run, or one-sided PR merge leaves a recoverable baseline; a retry or scheduled reconciliation advances it only when current mapped trees are equal (verification: unit and GitHub integration; owner: implementation author)
- AC7 — A Cherry Studio content PR can preview and validate its unmerged changes with the recorded website renderer without altering another checkout; malformed content fails the existing website content checks (verification: docs gate and local preview; owner: implementation author)
- AC8 — Fork checks cannot access synchronization credentials, arbitrary payload revisions are rejected, and bot-created synchronization PRs receive the target repository's normal required checks (verification: GitHub integration; owner: implementation author)
- AC9 — Website publication remains controlled by merging its PR and the existing deployment pipeline; reference-data automation retains its website-only outputs and explicitly requests synchronization when push events are suppressed (verification: GitHub integration; owner: implementation author)
- AC10 — Dry-run reports planned changes without writes, disabling synchronization preserves both copies, and resuming reconciles unsynchronized edits without resetting the baseline (verification: unit and GitHub integration; owner: implementation author)

## Risks

The imported assets increase desktop repository size. Content can differ while a synchronization PR waits for review, and a conflict blocks unrelated changes in the same batch. Independently valid navigation, locale, or alias edits may still combine into semantically invalid content; a clean Git merge must pass the website's validators and human review. A recorded renderer revision can fall behind website capabilities and must be updated deliberately.

Public documents also cover mobile features, so desktop contributors must preserve that content rather than treating it as unrelated cleanup. Shared content configuration can require coordinated renderer changes outside the mapping. Git history rewrites that remove a baseline revision require explicit recovery rather than guessing a new baseline. GitHub App provisioning and a real bidirectional integration run are required before claiming operational synchronization; local tests alone do not establish cross-repository permissions, required-check execution, or production publication.
