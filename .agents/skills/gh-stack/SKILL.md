---
name: gh-stack
description: Manage Cherry Studio stacked branches and pull requests with the GitHub gh-stack extension. Use for planning, creating, inspecting, rebasing, syncing, linking, or recovering a stack of dependent PRs.
metadata:
  author: github
  upstream-version: "0.0.8"
---

# GitHub Stack

Use `gh stack` for branch topology and synchronization. Use the repository's `gh-create-pr` skill for Cherry-specific PR bodies, Spec approval, AC coverage, verification, and Agent Note lifecycle.

## Availability and prerequisites

This public skill is tracked in `.agents/skills/` and discovered from the repository. Developers do not install a separate agent skill. `pnpm skills:sync` maintains the `.claude/skills/` compatibility symlink.

Run this preflight before the first `gh stack` command in a task:

```bash
command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI is required: https://cli.github.com/" >&2
  exit 1
}
gh auth status
if ! gh stack --help >/dev/null 2>&1; then
  gh extension install github/gh-stack
fi
gh stack --help >/dev/null
```

If GitHub CLI authentication, extension installation, or the final verification fails, stop and report the failing command. Do not guess stack topology with ad hoc branch comparisons.

Before initializing a stack, avoid extension prompts:

```bash
git config rerere.enabled true
```

When multiple remotes exist, resolve the intended remote and pass `--remote <name>` to commands that accept it. Do not silently change `remote.pushDefault` for the developer.

## Stack model

A stack is a linear dependency chain. The bottom branch is closest to the trunk; each higher branch contains only work that depends on the layer below it.

```text
main
  -> spec
    -> implementation-core
      -> implementation-ui
```

Plan the complete dependency order before creating branches. Put a newly discovered lower-layer change on its owning branch, then rebase the upstack branches; do not hide it in the current layer.

## Agent-safe commands

All commands must be non-interactive:

- Always run `gh stack view --json`; plain `view` opens a TUI.
- Always supply branch names to `init`, `add`, and `checkout`.
- Always use `--auto` with `submit` if that command is explicitly allowed.
- Pass `--remote <name>` to `push`, `submit`, `sync`, or `link` when more than one remote exists.
- Use ordinary `git add` and `git commit -S --signoff` so each layer is staged deliberately.

Common operations:

```bash
gh stack init --base main <bottom-branch> [<higher-branch>...]
gh stack add <new-top-branch>
gh stack view --json
gh stack push --remote <remote>
gh stack rebase --upstack --remote <remote>
gh stack sync --remote <remote>
gh stack checkout <branch-or-pr>
gh stack link --remote <remote> <bottom-pr> <higher-pr> [...]
```

Exit code `2` from `gh stack view --json` means the current branch is standalone. Exit code `3` from rebase or sync means conflicts require resolution followed by `gh stack rebase --continue`, or `gh stack rebase --abort` if the stack cannot be repaired safely. Exit code `9` means GitHub stacked PRs are unavailable for the repository; stop instead of silently publishing a different PR shape.

## Cherry PR creation

Do not use `gh stack submit --auto` to create human-authored Cherry PRs. It creates PRs before the required body preview and auto-generates bodies that do not satisfy the repository template.

Create a compliant stack bottom-up:

1. Push the branches with `gh stack push --remote <remote>`.
2. Invoke `gh-create-pr` for each layer, using the parent branch as that layer's base.
3. After every PR has its approved title and body, link the existing PRs with `gh stack link --remote <remote> <bottom-pr> <higher-pr> [...]`.
4. Verify the resulting topology with `gh stack view --json`.

`gh stack submit --auto` is allowed only for an explicitly authorized automation workflow that is exempt from the human PR template. It is not a shortcut around Cherry's preview requirement.

## Changes to an existing stack

When changing a lower layer:

1. Check out that branch explicitly.
2. Make and verify the focused change there.
3. Run `gh stack rebase --upstack --remote <remote>`.
4. Push or sync the stack.
5. For every rewritten live PR, rerun `pnpm change:scope --base <verified-parent-ref>` and only the checks invalidated by that rewritten scope.

After `gh stack sync`, inspect its output and run `gh stack view --json`; a successful command alone is not proof that each PR still has the intended base, scope, or verification.

## Lifecycle boundary

Follow `.agents/skills/agent-notes/SKILL.md` for Spec approval and lifecycle transitions. Intermediate implementation layers keep the note proposed. Only the final layer whose cumulative, actually-run evidence covers every approved AC may move the bilingual note triplet to `implemented/`.
