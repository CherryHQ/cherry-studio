---
description: Build, packaging and manual verification for DSH runtime upgrades
sources:
  - packages/dsh-bridge
  - src/main/ai/runtime/dsh
  - scripts/__tests__/dsh-runtime-packaging.test.ts
---

# DSH Runtime Upgrade Tests

## Scope

Cherry pins DSH dependencies in `packages/dsh-bridge/package.json`. The SDK launches
Cherry's bundled entry through `dshBin`; `CHERRY_DSH_CONFIG` selects the connection's
Cordis composition. API keys pass through the child environment.

A version-specific pnpm override excludes the unused SDK umbrella runtime.
Remove it only after verifying the upstream dependency contract and resolved lock graph.
Record version-specific findings and historical-log compatibility in the upgrade PR.

## Build

From the repository root with the project's Node/pnpm prerequisites installed:

```sh
pnpm install --frozen-lockfile
pnpm --filter @cherrystudio/dsh-bridge build
pnpm build
```

Outputs are `packages/dsh-bridge/dist/runtime/` and `out/`; no installer is produced.
Rebuild the bridge after plugin, entry or dependency changes before integration tests.

## Automated checks

```sh
pnpm --filter @cherrystudio/dsh-bridge exec tsc --noEmit
pnpm --filter @cherrystudio/dsh-bridge test
pnpm exec vitest run --project main src/main/ai/runtime/dsh/__tests__
pnpm exec vitest run --project scripts scripts/__tests__/dsh-runtime-packaging.test.ts
pnpm lint
```

Coverage includes approvals, cancellation, workspace validation, stream/trace
projection, developer-role and PNG fixtures, packaging, dependency exclusions and
plugin settings. These checks do not launch an installed app or establish
current-turn rejection feedback, Full Access parameter handling or old-log compatibility.

## Manual model and UI checks

Use an isolated profile, disposable workspace and test model. Run `pnpm start`
and select a DSH agent. These checks call the model and may incur charges.

| Scenario | Action | Expected result |
| --- | --- | --- |
| Streaming/cancellation | Request a long list; cancel, then send another message | Streaming stops and the next turn works |
| File approval | Request `upgrade-smoke.txt`; reject, then retry and approve | Only approval creates the file, in the test workspace |
| Rejection feedback | Reject with/without a reason; separately approve | The current turn receives the rejection reason; approval injects no rejection feedback |
| Full Access parameters | Try paired, unpaired, empty and repeated escalation parameters, including two calls in one response | Invalid calls return corrective errors without execution or a forced stop; corrected calls and later turns work |
| Plan review | Request a plan to create a file without implementing it | No write occurs; the review question accepts an answer |
| Cold resume | Restart after a short conversation, then continue | History and workspace persist; no autonomous turn starts |
| Images/MCP | Attach a PNG; call an MCP tool returning text and an image | No missing exports; both results display correctly |
| Skills | Enable, use, then disable a test skill | Exposure follows the enabled state |
| Subagents | Delegate a file summary; also test cancellation | Events/completion reach the parent; cancellation leaves no work running |
| Compaction | Build history, invoke `/compact`, then continue | Compaction completes, context usage refreshes and the next turn works |

Test a **copy** of a previously shipped session log in an isolated profile before
adopting an upgrade. Preserve the backup and original; offline tests prove neither
old-log compatibility nor rollback safety. Verify native shell/sandbox behavior on
Windows, macOS and Linux before release.
