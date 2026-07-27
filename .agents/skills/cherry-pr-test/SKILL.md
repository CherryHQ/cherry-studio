---
name: cherry-pr-test
description: Test Cherry Studio PRs by resolving and checking out a PR, statically inspecting its changes, running interactive UI tests against a safely tracked Electron instance through CDP, producing a structured report, cleaning up only the owned test instance, and restoring the original branch.
---

# Cherry Studio PR Test

Use this workflow for a bounded PR test. Use `cherry-electron-dev` for ongoing
implementation or debugging in the current checkout.

## Prerequisites and safety

- Require authenticated `gh`, `pnpm`, and installed project dependencies.
- Use Playwright/CDP or optional `agent-browser` for UI control.
- Before touching Electron, read
  [Electron Instance Management](../cherry-electron-dev/references/electron-instance.md)
  and select its `ephemeral` policy.
- Treat that reference as the only authority for discovery, target selection,
  launch, replacement, shutdown, tracking, and troubleshooting.
- Never discard local changes. Stop and ask if checkout would overwrite them.
- Show the report before posting it anywhere.

`$ARGUMENTS` may contain a PR number, PR URL, `latest`/`recent`, or nothing.

## Workflow

### 1. Resolve and inspect the PR

If no PR is specified, list recent PRs and ask the user to choose unless they
requested the latest:

```bash
gh pr list --repo CherryHQ/cherry-studio --state open --limit 10 \
  --json number,title,author,createdAt,headRefName,changedFiles
```

Record the current branch for restoration, inspect the PR, then check it out:

```bash
git status --short
git branch --show-current
gh pr view <NUMBER> --json title,body,author,headRefName,files
gh pr checkout <NUMBER>
```

Read the changed files and nearby instructions. Record the exact checked-out
HEAD.

### 2. Analyze and start the app

Run static analysis while the app starts when both can proceed independently.

For static analysis:

```bash
pnpm typecheck
```

Also check:

- blocked or deprecated v1/v2-refactor files
- hardcoded user-visible strings instead of i18n
- `console.log` instead of `loggerService`
- missing types on new public interfaces

For Electron:

1. Use the shared reference to verify existing instances.
2. Reuse only an instance from this workspace whose recorded launch HEAD equals
   the checked-out PR HEAD.
3. When reusing one, mark it borrowed and preserve its existing policy and
   ownership. Never reclassify a persistent instance as ephemeral.
4. Otherwise gracefully replace only the verified same-workspace instance.
5. Launch an `ephemeral`, agent-owned instance with an isolated
   `CS_DEV_USER_DATA_SUFFIX`, such as `PR-<NUMBER>`.
6. Keep its managed terminal/session, PIDs, ports, log, exact target, and
   `pr-test:<NUMBER>` launch purpose in
   `instance.json`.

Do not use broad process or port cleanup.

### 3. Run interactive tests

Bind the controller to the exact target returned by the shared reference.
Never navigate to a guessed root URL or select a target by index.

Build test cases from the PR description and changed files:

1. Capture the initial state.
2. Inspect interactive elements with the available CDP controller.
3. Exercise the changed behavior.
4. Capture the result and verify relevant persisted state.
5. Repeat edge cases justified by the change.

Consider UI rendering, interactions, persistence, light/dark themes, relevant
window sizes, i18n, empty states, and rapid interaction only when in scope.

Store screenshots and the report under `/tmp/pr-<NUMBER>/`:

```bash
mkdir -p /tmp/pr-<NUMBER>
```

If an isolated profile shows the migration wizard or splash, follow the shared
troubleshooting guidance and startup logs. Do not reset or force-close data.

### 4. Clean up and restore

Use the shared `ephemeral` finish procedure. Stop only an instance launched by
this PR-test workflow whose verified record remains `ephemeral`, agent-owned,
and scoped to `pr-test:<NUMBER>`. Leave every borrowed instance running. Do not
stop unrelated workspaces or packaged apps.

Restore the branch recorded before checkout. If it no longer exists, resolve
the repository default branch and report the fallback before switching:

```bash
git checkout <ORIGINAL_BRANCH>
```

### 5. Report

Save `/tmp/pr-<NUMBER>/report.md` and show it to the user. Match the report
language to the user's language; the template uses English labels:

```markdown
# PR #<NUMBER> Test Report

**Title**: <title>
**Author**: @<author>
**Branch**: <branch>
**Changed files**: <count>

## Static Analysis

| Check | Result | Notes |
| --- | --- | --- |
| TypeScript typecheck | ✅/❌ | ... |
| Blocked-file check | ✅/⚠️ | ... |
| Logging, i18n, and types | ✅/❌ | ... |

## UI Tests

### <Test Case>

<scenario, evidence, and result>

![screenshot](<filename>.png)

## Findings

<findings or none>

## Conclusion

- Total findings: N
- Recommendation: APPROVE / REQUEST_CHANGES / COMMENT
```

Do not post the report or submit a GitHub review unless the user explicitly
asks.
