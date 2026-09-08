---
description: Build and regression examples for the DSH 0.1.2-rc.1 runtime, including offline subprocess startup and persisted session recovery
sources:
  - packages/dsh-bridge
  - src/main/ai/runtime/dsh
  - scripts/__tests__/dsh-runtime-packaging.test.ts
---

# DSH Runtime Upgrade Tests

## Scope

Cherry pins DSH to `0.1.2-rc.1`. The removed demo executable and agent spine are replaced by a Cherry-owned boot entry and an explicit Cordis composition. The SDK starts that entry through `dshBin`; `CHERRY_DSH_CONFIG` points to the per-connection composition. API keys remain in the child environment, not in the YAML.

The upgrade also uses `ToolCallId`, branded `SessionSeq` values, session snapshots, the user-question event listener, and the four-argument command API. The old developer-role compatibility patch is removed because the new adapter supports that setting directly.

## Build

Run these commands from the repository root with the project's Node/pnpm prerequisites installed:

```sh
pnpm install --frozen-lockfile
pnpm --filter @cherrystudio/dsh-bridge build
pnpm build
```

The bridge runtime is generated under `packages/dsh-bridge/dist/runtime/`; the application build is under `out/`. This does not produce an installer. Rebuild the bridge after changing its plugin, entry list, or dependencies before running the integration tests.

## Example 1: Offline Startup and Session Recovery

```sh
pnpm exec vitest run --project main src/main/ai/runtime/dsh/__tests__/runtimeUpgrade.test.ts
```

This test launches the built runtime twice using the real SDK and authenticated Cherry bridge. It checks initialization, session creation, unknown-command handling, context usage, and recovery after process shutdown. The first launch commits plan mode; the second must report `noop` when enabling it again. This catches a broken resume path that silently creates a fresh session.

No model request or tool execution is allowed. The model endpoint is a dummy loopback URL; the workspace, composition, and session logs use a temporary directory that is cleaned up afterward. No production session data or real API key is needed. This verifies sessions written by rc.1, not migration of rc.7 logs.

## Example 2: Bridge, Adapter, and Packaging Regression

```sh
pnpm --filter @cherrystudio/dsh-bridge exec tsc --noEmit
pnpm --filter @cherrystudio/dsh-bridge test
pnpm exec vitest run --project main src/main/ai/runtime/dsh/__tests__
pnpm exec vitest run --project scripts scripts/__tests__/dsh-runtime-packaging.test.ts
pnpm lint
```

These suites cover approval and cancellation, missing-workspace denial, session workspace mismatch, stream and trace projection, developer-role compatibility against a local HTTP fixture, real PNG processing through the bundled attachment API, and runtime packaging rules. The packaging suite does not launch an installed application.

## Example 3: Manual Model and UI Checks

Use an isolated test profile and a disposable workspace. Start the built application with `pnpm start`, select DSH for a test agent, and configure a test model. The following examples can incur model charges; they are not part of the offline suite.

| Scenario | Example input / action | Expected result |
| --- | --- | --- |
| Streaming and cancellation | Ask for a long numbered list; cancel midway | Text streams normally, cancellation ends the turn, and a subsequent message works |
| File approval | Ask to create `upgrade-smoke.txt` containing `hello`; reject approval, then retry and approve | Rejection leaves no file; approval creates it only in the test workspace |
| Plan review | Enable plan mode and ask for a plan to create the file, without implementing it | No write occurs during planning; the review question appears and accepts an answer |
| Cold resume | Complete a short conversation, close the app, reopen that session, and continue | History and workspace remain consistent; no unintended autonomous turn starts |
| Images and MCP | Attach a small PNG; call a test MCP tool that returns text and an image | No missing-export error; text and image references are displayed correctly |
| Skills | Enable a harmless test skill, use it, then disable it | Enabled skill is discoverable; disabled skill is no longer exposed |
| Subagents | Ask a child agent to summarize one test file | Child events and completion reach the parent; cancellation does not leave work running |
| Compaction | Build a short history and invoke `/compact` | Command completes, context usage refreshes, and the next turn still works |

Before adopting rc.1 for existing data, back up the application data and test a **copy** of an rc.7 session log in an isolated profile. Keep the original unchanged; the automated recovery example does not establish old-log compatibility or rollback safety. Repeat native shell/sandbox checks on Windows, macOS, and Linux before release.
