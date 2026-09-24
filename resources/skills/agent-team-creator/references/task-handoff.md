# Task state and handoff requests

Use Node.js 22 or newer. Save each request as a UTF-8 JSON file, then invoke the packaged entry point:

```text
node <skill>/scripts/cli.mjs <command> --input request.json
```

Replace `<skill>` with the installed **agent-team-creator** directory. The sibling manage and handoff skills use this same runtime. Relative `state`, `cwd`, and request-file paths resolve from the process working directory. A command returns JSON on stdout; failures return an error on stderr and a nonzero exit code. The examples use JSON files directly and require no shell redirects or pipelines.

## Initialize, inspect, and revise the team

Save `init.json`:

```json
{
  "state": ".agent-teams/docs-team.json",
  "team": {
    "schemaVersion": 1,
    "id": "docs-team",
    "outcome": "Implement a small documentation improvement and independently review it",
    "scope": "project",
    "harness": "codex",
    "roles": [
      {
        "id": "implementer",
        "description": "Makes the requested documentation change",
        "prompt": "Implement the assigned change within docs/. Report evidence and remaining work.",
        "skills": [], "owns": ["docs/**"],
        "inputs": ["Task requirements"], "outputs": ["Documentation patch"],
        "dependsOn": []
      },
      {
        "id": "reviewer",
        "description": "Independently checks the patch",
        "prompt": "Review the assigned patch and record actionable findings. Do not edit the implementer's files.",
        "skills": [], "owns": ["reviews/**"],
        "inputs": ["Documentation patch"], "outputs": ["Review findings"],
        "dependsOn": ["implementer"]
      }
    ]
  }
}
```

```text
node <skill>/scripts/cli.mjs init --input init.json
```

Initialization creates state revision `0` with empty tasks, handoffs, events, and memory outbox. It refuses to replace an existing state file. These roles describe responsibilities; initialization does not launch agents, install skills, or enforce `owns` paths.

Save `status.json`:

```json
{"state": ".agent-teams/docs-team.json"}
```

```text
node <skill>/scripts/cli.mjs status --input status.json
```

Use `team-update` to replace the entire manifest while retaining its `id`. It is not a patch operation. Save `team-update.json`, copying the current state revision into `expectedRevision`:

```json
{
  "state": ".agent-teams/docs-team.json",
  "expectedRevision": 0,
  "team": {
    "schemaVersion": 1,
    "id": "docs-team",
    "outcome": "Improve the setup guide and independently verify every documented step",
    "scope": "project",
    "harness": "codex",
    "roles": [
      {
        "id": "implementer", "description": "Updates the setup guide",
        "prompt": "Implement the assigned documentation change and record evidence.",
        "skills": [], "owns": ["docs/**"], "inputs": ["Task requirements"],
        "outputs": ["Documentation patch"], "dependsOn": []
      },
      {
        "id": "reviewer", "description": "Verifies the setup instructions",
        "prompt": "Independently review the patch and record findings in reviews/.",
        "skills": [], "owns": ["reviews/**"], "inputs": ["Documentation patch"],
        "outputs": ["Review findings"], "dependsOn": ["implementer"]
      }
    ]
  }
}
```

```text
node <skill>/scripts/cli.mjs team-update --input team-update.json
```

Keep roles referenced by tasks or by either endpoint of historical handoffs. Reassigning an active task does not erase historical handoff role references. Updating the manifest does not regenerate native exports or change existing task harnesses. Role dependencies describe the team; task execution uses each task's explicit `dependsOn` list.

## Mixed-harness implementation and independent review

The team manifest supplies one default harness. Each task and handoff destination can select a different harness. For a Codex implementation with a Claude Code reviewer:

1. Export the team to separate Codex and Claude proposal directories. Select the intended Codex implementer and Claude reviewer definitions before installation; each export contains all roles. Verify destination skills and model availability independently.
2. Add an implementation task owned by `implementer` with `harness: "codex"`. Add a separate review task owned by `reviewer` with `harness: "claude"` and `dependsOn: ["implementation-task-id"]`. Role dependencies do not automatically create task dependencies.
3. Complete implementation with actual evidence. Start the review task only after its dependency is complete. Record review findings and completion on that separate task.
4. If dispatch requires destination acceptance, initially assign the review task to the dispatching role, then create a handoff for that review task to `reviewer`/`claude`. Acceptance transfers ownership; the dependency still prevents premature start. Re-read revisions before every mutation.

Reassigning the implementation task is useful when another harness continues the same work. Independent review uses its own task so its evidence and responsibility remain distinct. Exports and assignments do not launch either harness.

## Two revision checks

Every modifying command after initialization requires top-level `expectedRevision`, taken from the latest state. Updating an existing task also requires `owner` and `expectedTaskRevision`, taken from that task. Both revisions are nonnegative integers. A stale revision or incorrect owner fails before persistence; do not retry by guessing the next number. Read `status`, review intervening changes, then submit the intended operation with current values.

A successful change increments state revision once. A task change increments that task's revision once. Adding a task starts its revision at `0`. Creating a handoff increments state revision but leaves task revision and owner unchanged. An unchanged operation, including a valid duplicate handoff acceptance, leaves state revision unchanged.

The following lifecycle examples illustrate successive operations **after a fresh init, without the optional team-update above**. If any other operation occurs, replace the illustrated revisions with values from `status`.

## Task lifecycle

Save `add-task.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 0,
  "task": {
    "action": "add", "id": "setup-guide", "title": "Clarify the setup guide",
    "owner": "implementer", "harness": "codex",
    "dependsOn": [], "evidence": [], "remaining": ["Update the examples and check them"]
  }
}
```

```text
node <skill>/scripts/cli.mjs task --input add-task.json
```

`add` requires `id`, `title`, and an existing role as `owner`. `harness` defaults to the team's harness. `dependsOn`, `evidence`, and `remaining` default to empty arrays. Optional `modelPolicy` follows the manifest policy schema; optional `kbd` links canonical identity as described below. New tasks are `pending`. Dependencies must already exist, cannot refer to the task itself, cannot repeat, and must form an acyclic graph.

Save `start-task.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 1,
  "task": {"action": "start", "id": "setup-guide", "owner": "implementer", "expectedTaskRevision": 0}
}
```

```text
node <skill>/scripts/cli.mjs task --input start-task.json
```

Only `pending` or `blocked` tasks can start. Every dependency must be `complete`; cancellation does not satisfy a dependency. Starting records local `running` status and does not launch a harness.

Save `block-task.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 2,
  "task": {
    "action": "block", "id": "setup-guide", "owner": "implementer", "expectedTaskRevision": 1,
    "reason": "Need the supported runtime version", "evidence": ["notes/version-question.md"]
  }
}
```

```text
node <skill>/scripts/cli.mjs task --input block-task.json
```

`block` accepts `pending` or `running` tasks and requires `reason`. The reason remains in `remaining`, including when an explicit `remaining` array is supplied. To resume after resolving it, save `resume-task.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 3,
  "task": {
    "action": "start", "id": "setup-guide", "owner": "implementer", "expectedTaskRevision": 2,
    "remaining": ["Check the corrected setup examples"]
  }
}
```

```text
node <skill>/scripts/cli.mjs task --input resume-task.json
```

An explicit reassignment transfers local ownership immediately; use a handoff instead when the destination must accept first. Save `reassign-task.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 4,
  "task": {
    "action": "reassign", "id": "setup-guide", "owner": "implementer", "expectedTaskRevision": 3,
    "toOwner": "reviewer", "toHarness": "claude"
  }
}
```

```text
node <skill>/scripts/cli.mjs task --input reassign-task.json
```

The destination owner must be an existing role. `toHarness` defaults to the task's current harness, and at least one of owner/harness must change. Reassigning a running task returns it to `pending`; a blocked task stays blocked. The runtime does not stop the source process. Coordinate that separately before another worker edits the same files.

Save `start-review.json`, then run it:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 5,
  "task": {"action": "start", "id": "setup-guide", "owner": "reviewer", "expectedTaskRevision": 4}
}
```

```text
node <skill>/scripts/cli.mjs task --input start-review.json
```

Save `complete-task.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 6,
  "task": {
    "action": "complete", "id": "setup-guide", "owner": "reviewer", "expectedTaskRevision": 5,
    "evidence": ["reviews/setup-guide.md"], "remaining": []
  }
}
```

```text
node <skill>/scripts/cli.mjs task --input complete-task.json
```

Completion requires `running` status, all dependencies complete, a supplied `evidence` array, at least one evidence entry after merging prior evidence, and no remaining work. Evidence entries are references or descriptions; the runtime does not independently verify their claims. Explicit `remaining: []` clears previously recorded remaining work.

As an **alternative to completion**, save `cancel-task.json` at the same pre-completion snapshot:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 6,
  "task": {
    "action": "cancel", "id": "setup-guide", "owner": "reviewer", "expectedTaskRevision": 5,
    "reason": "The requested guide change was withdrawn"
  }
}
```

```text
node <skill>/scripts/cli.mjs task --input cancel-task.json
```

Cancellation requires a reason and is available for any nonterminal task. `complete` and `cancelled` are terminal: they cannot be restarted, reassigned, accepted through a handoff, or deleted through the runtime. Create a new task for subsequent work. Updating evidence on nonterminal actions merges it with existing evidence; an explicit `remaining` array replaces the current list, subject to the block-reason rule above.

## Create and accept a handoff

This separate example assumes a task named `setup-guide` is still owned by `implementer`, running on `codex` at task revision `1`, with state revision `2`. These are the values immediately after the earlier start example. A handoff is a context packet; creating it does not transfer ownership or dispatch the destination harness.

Save `handoff-create.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 2, "cwd": ".",
  "handoff": {
    "taskId": "setup-guide", "owner": "implementer", "expectedTaskRevision": 1,
    "toOwner": "reviewer", "toHarness": "claude",
    "context": "The examples are drafted. Review the patch and verify the setup instructions.",
    "evidence": ["docs/setup.md"],
    "remaining": ["Check the examples and record findings"],
    "memoryRefs": ["notes/setup-decisions.md"]
  }
}
```

```text
node <skill>/scripts/cli.mjs handoff-create --input handoff-create.json
```

The field is `handoff.taskId`, while task actions use `task.id`. All listed handoff fields are required. Evidence, remaining work, and memory references may be empty arrays; existing task evidence and remaining work are preserved in the packet. Source and destination must differ by owner or harness. Harness identifiers are `uar`, `codex`, `claude`, `copilot`, `kimi`, `minimax`, `opencode`, or `deepseek`; `bossfang` is an export target, not a handoff harness identifier.

The returned state contains a generated `handoffs[].id`, the source task revision, source/destination identities, context, evidence, remaining work, memory references, and a fresh-context `prompt`. It captures real Git root, HEAD, branch, and dirty status, including untracked files, using read-only Git commands. Git failures leave unavailable fields `null`; detached HEAD may have a known commit and `branch: null`. A fallback `git.root` is the requested directory, not proof that it is a repository. `dirty: null` means unknown, never clean. This snapshot does not copy the working tree, untracked files, memory content, or evidence files, and it may become stale as work continues.

Open the destination harness separately, provide the fresh prompt and reachable artifacts, and review destination instructions. Source session identifiers, credentials, permissions, native approvals, and sandbox capabilities do not transfer. The destination's native controls remain authoritative.

Copy the generated ID into `handoff-accept.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 3,
  "id": "REPLACE_WITH_HANDOFF_ID",
  "destination": {"owner": "reviewer", "harness": "claude"}
}
```

```text
node <skill>/scripts/cli.mjs handoff-accept --input handoff-accept.json
```

Acceptance checks the targeted owner/harness against the packet, then checks the task's current owner, source harness, and recorded task revision. A stale, reassigned, cancelled, or completed task is rejected. On success, ownership and harness transfer, task revision advances to `2`, a running task becomes `pending`, packet evidence and remaining work are retained, and `acceptedAt` plus an acceptance event commit atomically in the same state file. Blocked tasks stay blocked. The destination must explicitly start its task before completing it.

At this snapshot state revision is `4`. To retry the **same** acceptance, use the same ID and destination but set `expectedRevision` to **4**, or to the latest state revision if unrelated work changed it. Reusing the original `expectedRevision: 3` fails the state check before idempotency is considered. An unchanged duplicate returns the same receipt without incrementing either revision. If the accepted task subsequently changes revision, owner, harness, or becomes terminal, the old acceptance is rejected as stale. This prevents an old packet from reclaiming ownership after later work.

Handoff snapshots and accepted receipts are immutable through the runtime. Task events are append-only. A rejected or superseded pending packet remains historical; create a fresh handoff from the current task when needed.

## Complete a task linked to canonical KBD

Attach `kbd` when adding the task. Read all five identity values from the real canonical KBD state, rather than assuming the local team/task names match. Example `add-kbd-task.json` below assumes state revision `7` after ordinary completion above; replace placeholders and revision before use:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 7,
  "task": {
    "action": "add", "id": "canonical-docs", "title": "Deliver the KBD documentation task",
    "owner": "implementer", "harness": "codex", "dependsOn": [],
    "evidence": [], "remaining": [],
    "kbd": {
      "projectId": "PROJECT_ID_FROM_KBD_STATUS", "runId": "RUN_ID_FROM_KBD_STATUS",
      "phaseId": "PHASE_ID_FROM_KBD_STATUS", "changeId": "CHANGE_ID_FROM_KBD_STATUS",
      "taskId": "TASK_ID_FROM_KBD_STATUS"
    }
  }
}
```

```text
node <skill>/scripts/cli.mjs task --input add-kbd-task.json
```

Adding a link validates its structure only; it does not register or start canonical work. Canonical identity is immutable on that team task. Save `start-kbd-task.json`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 8,
  "task": {"action": "start", "id": "canonical-docs", "owner": "implementer", "expectedTaskRevision": 0}
}
```

```text
node <skill>/scripts/cli.mjs task --input start-kbd-task.json
```

Follow KBD's own required start, evidence, and boundary workflow separately. Ordinary `task` completion refuses linked tasks.

Save `complete-kbd.json` once the local task is running and the canonical task is `in_progress`:

```json
{
  "state": ".agent-teams/docs-team.json", "expectedRevision": 9, "cwd": ".",
  "task": {
    "id": "canonical-docs", "owner": "implementer", "expectedTaskRevision": 1,
    "kbdCli": "/absolute/path/to/prometheus",
    "evidence": ["reviews/canonical-docs.md"], "remaining": []
  }
}
```

```text
node <skill>/scripts/cli.mjs complete-kbd --input complete-kbd.json
```

`complete-kbd` uses the task object directly; no `action` field is required. `kbdCli` is an explicit executable, preferably an absolute path to the intended Prometheus CLI, not a command string containing arguments. This avoids confusing another executable named `prometheus` on PATH. The runtime executes argument arrays with `shell: false`:

```text
<kbdCli> kbd --path <cwd> status --json
<kbdCli> kbd --path <cwd> task transition --command-id <stable-id> --phase <phaseId> --change <changeId> --id <taskId> --status complete --summary <evidence-summary>
```

Preflight checks canonical project/run identity, a nonzero canonical revision, and the exact phase/change/task records. The canonical task must be `in_progress` or already `complete`. After a transition, the returned committed state must confirm the same identities and `complete` status. Only then does the local task become complete. The local `kbd.task.completed` event records the command ID, actual argv, canonical revision/event ID when available, response hash, identity, and evidence. If canonical work was already complete, a real status read produces an explicitly labeled reconciliation receipt instead of claiming a newly committed transition.

The canonical CLI creates its own current frontier and exposes no caller-supplied expected-run/revision argument. Preflight and response checks detect drift; they cannot atomically bind the initial identity check to the later canonical mutation. A concurrent run rollover can therefore create a cross-store race. Avoid changing canonical run identity during this operation. The local state lock does not lock KBD.

A CLI failure, timeout, invalid response, or identity mismatch leaves local completion unrecorded. Canonical work may nevertheless have committed. Read canonical and local status before retrying with current local revisions. If the canonical task is now complete and identities still match, retry can reconcile it. A crash after canonical commit but before local persistence has the same recovery path. This is not a distributed transaction, and the runtime never erases KBD history to make the stores agree.

The completion adapter does not emit fabricated KBD boundary receipts or call Karpathy hooks for arbitrary team events. Native KBD guards still apply; team state and local events are coordination records, not replacement canonical authority.

## Local persistence and recovery

State is one JSON file on a local filesystem. Writers acquire `<state-file>.lock` with exclusive creation, validate revisions and state, write a uniquely named temporary file in the same directory, and atomically rename it over the state file. Readers see the old or new complete document. Failed validation or a throwing callback does not commit partial local state. Asynchronous memory publication holds the same lock across its operation; remote effects remain outside the local transaction.

Use a local filesystem with reliable exclusive creation and same-directory atomic rename. NFS, network shares, cloud-synchronized folders, and multi-machine concurrent writes are not supported coordination backends. Local roles, ownership assertions, and file locks are advisory coordination among cooperating processes; they do not authenticate a caller, enforce native permissions, stop agents, or provide distributed leases. Anyone with direct file-write access can bypass the runtime, so preserve ordinary operating-system access controls.

There is no automatic lock timeout, retry takeover, or stale-lock stealing. A crash may leave the lock behind. To recover, inspect its recorded `pid`, `at`, and `token`; verify no writer still owns it, including another session, then remove only that abandoned lock manually. Do not remove a live writer's lock. Inspect current state and any uncertain external KBD/memory operation before retrying. Temporary files are not authority and must not be renamed over state as an improvised recovery procedure.

Source contracts: [CLI dispatcher](../runtime/src/cli.mts), [state transactions](../runtime/src/state.mts), [task actions](../runtime/src/state-tasks.mts), [handoff operations](../runtime/src/handoff.mts), [KBD completion](../runtime/src/state-kbd.mts), and [boundary validation](../runtime/src/state-validation.mts).
