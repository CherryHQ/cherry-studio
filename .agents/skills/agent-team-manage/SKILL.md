---
name: agent-team-manage
description: "Manage an existing agent team: assign tasks, dependencies and owners, update definitions, track evidence, cancel or reassign work, and reconcile KBD-linked completion. Use when managing team lifecycle requests; use agent-team-creator for initial team discovery and agent-team-handoff to transfer work across harnesses. Do not use for initial team creation (see agent-team-creator)."
license: MIT
compatibility: Requires Node.js 22 or newer. Git is optional for handoff snapshots. Model gateways, memory services and native harness CLIs are optional and separately configured.
metadata:
  version: "1.0.0"
  tags: "agents, teams, orchestration, coding"
---

# Agent Team Manager

Locate the existing team state and load the companion `agent-team-creator` skill.
Use its compiled `<agent-team-creator>/scripts/cli.mjs`; do not recreate its runtime. If that companion
is absent, report the missing package and resolve it through the authorized skill
installation flow. Read its `references/task-handoff.md` for exact JSON requests.

1. Read project instructions and `status`. Inspect the current state revision,
   task revisions, owners, dependencies, native harness and actual evidence.
2. Assign bounded tasks with deliverables and file ownership. Use native harness
   tools to spawn work only when authorized. The ledger records coordination;
   it does not launch agents or make a local owner string an authenticated identity.
3. Use `task` actions `add`, `start`, `block`, `complete`, `cancel`, or `reassign`.
   Mutations carry `expectedRevision`; task updates also carry current `owner`
   and `expectedTaskRevision`. Do not silently retry a conflict with a newer
   revision—re-read and reconcile the competing work first.
4. Start work after dependencies complete. Record real evidence before completing
   it. Blocking/cancellation need a reason. Completed and cancelled tasks are
   terminal; create a new task for follow-up work instead of rewriting history.
5. For a KBD-linked task, preserve project/run/phase/change/task identity. Use
   `complete-kbd` with the actual KBD CLI; direct local completion is refused.
   Inspect canonical state after uncertain outcomes. This does not replace KBD
   stage, review, archive or Karpathy boundary procedures.

```text
node <agent-team-creator>/scripts/cli.mjs status --input status-request.json
node <agent-team-creator>/scripts/cli.mjs task --input task-request.json
node <agent-team-creator>/scripts/cli.mjs team-update --input definition-request.json
```

Use `team-update` for validated role, skill, model or native settings while
preserving team identity and referenced historical roles. Re-export to a new
proposal directory afterward; a local edit does not update a resident UAR or
BossFang instance. Keep native IDs and registration receipts when applying such
updates through those services’ documented APIs.

Use `$agent-team-handoff` for a context-bearing transfer. Ordinary reassignment
is explicit administrative intervention and invalidates older handoffs. Cancel
the corresponding native work separately when authorized; cancelling a ledger
task cannot stop a running process.

Optional shared-memory publication uses the creator’s `memory-queue` followed by
`memory-publish`. Persist the queued record first. Follow its
`references/models-memory.md` for scope mappings, environment credentials,
failure receipts and uncertain retry handling. For Karpathy logs, invoke the
existing canonical process skill after real boundaries; `pk` remains the writer
of its knowledge bundle. Never manufacture a completion log from a team event.

Finish with actual changes, evidence, remaining work and revision. Do not claim
native execution, policy enforcement or remote cancellation from local state.
