---
name: verify-cherry-cloud
description: Verify Cherry Cloud ownership, subscription races, queued targets and preserved external contracts after changing Cloud services, IPC, selector composition or Claude rejection recovery.
---

# Verify Cherry Cloud

Read the [ownership Spec](../../notes/proposed/architecture/2026-11-08-cherry-cloud-ownership-convergence.md) and the [coverage record](verification.md). Preserve business and external contracts while correcting the enumerated defects; exact trace equivalence to known defects is not the goal.

## Run

Install the repository's pinned dependencies with `pnpm install`, then run from its root:

```sh
node .agents/skills/verify-cherry-cloud/scripts/verify.mjs
```

The command checks parsed contract identity and ownership boundaries, then runs explicit main, renderer and native-adapter test files. Native cases use the pinned real Claude SDK/CLI with a local Messages endpoint and isolated temporary storage. The command does not contact an account backend. Run Node tests before launching Electron in this checkout because they rebuild SQLite for Node.

For a focused change, the commands and explicit test paths in `scripts/verify.mjs` identify each affected group; repository scope rules still apply. The previous TLA+ design diagrams are not implementation proof. If adding or changing a TLA+ model, use `/statechart` to interpret every result and its shortest counterexample.

## Check that verification can fail

Only while all source writers, tests and Electron are idle, run:

```sh
node .agents/skills/verify-cherry-cloud/scripts/mutations.mjs
```

This command temporarily changes real source files, checks each deliberate break, restores each original, and confirms restored controls pass. It saves original copies and logs under `.context/cherry-cloud-verification/mutations/`. It refuses to overwrite a concurrent edit. If interrupted, inspect `pending.json` and its named original backup before continuing; preserve any concurrent work. Never treat a compiler/import failure or a control failure as a detected property violation.

## Interpret and maintain

`contracts.mjs` compares against merged commit `b22aae1dd46d2cacae5c35dba95412a4420e42ab`. Formatting and comments are ignored. A changed declaration or protected method is a request for contract review, not a reason to blindly update the baseline. An intentional external change needs an explicit decision and updated client/backend evidence.

`verification.md` maps properties to actual owners and states the bounds. `coverage.json` records the exact reviewed source content and commit synchronization state. When a covered function changes, re-read its implementation and consumers, update the scheduling/input assumptions or mutation anchors as needed, and rerun the checks. Advance the synchronization commit only after confirming the verification describes that code; include source hashes for an uncommitted worktree. Use `/maintain-formal-verification-skill` for changes that bypassed this process.

A pass establishes only the stated structural identities, finite input partitions and scheduled client contracts. It does not prove arbitrary JavaScript executions, browser delivery, purchase completion, or deployed backend behavior.
