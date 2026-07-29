# English Learning Upgrade Design

## Goal

Keep the English-learning customization easy to carry across Cherry Studio upgrades without freezing the fork or duplicating upstream subsystems.

## Chosen approach

Maintain a thin fork:

- `upstream` points to `CherryHQ/cherry-studio`.
- Custom work stays as a small, ordered commit stack above upstream.
- Feature-owned modules remain isolated under the existing English-learning domains.
- Changes to upstream-owned files are treated as explicit integration seams.
- Git `rerere` records recurring conflict resolutions locally.
- One compatibility command validates the critical seams and focused behavior after every rebase.

This is preferred over maintaining a permanent long-lived base fork or moving the feature into Obsidian. Cherry Studio remains the system of record and runtime; Obsidian remains an optional export target.

## Upgrade flow

1. Fetch `upstream/main`.
2. Create a temporary worktree and rebase the customization there first.
3. Resolve conflicts by preserving the current upstream architecture and reapplying only the documented English-learning contract.
4. Run `pnpm english-learning:check`.
5. Run the repository-wide `pnpm build:check`.
6. Rebase the real customization branch only after the rehearsal passes.

## Compatibility contract

The automated check covers the seams most likely to disappear silently during an upstream refactor:

- lifecycle service registration;
- DataApi and IpcApi handler registration;
- sidebar, launchpad, and route entry points;
- translation, selection-assistant, and temporary-chat ingestion;
- shared preference, cache, and source-kind contracts;
- the focused English-learning tests.

The complete operator runbook and seam inventory live in
[`docs/guides/custom-english-learning-upgrades.md`](../guides/custom-english-learning-upgrades.md).

## Failure policy

A missing file or marker is an upgrade failure, not an instruction to restore old code verbatim. The maintainer should inspect the new upstream architecture, move the integration to its current extension point, update the contract check, and record that decision in the rebase commit.

