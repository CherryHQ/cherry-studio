---
description: Build and packaging regression commands with manual approval and sandbox checks for the embedded DSH runtime
sources:
  - packages/dsh-bridge
  - src/main/ai/runtime/dsh
  - scripts/__tests__/dsh-runtime-packaging.test.ts
---

# DSH Runtime Upgrade Tests

## Scope

Cherry embeds a version-pinned DSH runtime using a Cherry-owned boot entry and an explicit Cordis composition. The SDK starts that entry through `dshBin`; `CHERRY_DSH_CONFIG` points to the per-connection composition. API keys remain in the child environment, not in YAML. Read `packages/dsh-bridge/package.json` for the current version; record upgrade-specific findings and historical-data compatibility in the PR.

The SDK's optional default-launch convenience path is not used. Until upstream makes its umbrella runtime dependency optional or a peer, a version-specific pnpm override removes that dependency. The packaging suite checks the resolved lock graph; remove the override only after verifying the upstream contract.

## Build

Run these commands from the repository root with the project's Node/pnpm prerequisites installed:

```sh
pnpm install --frozen-lockfile
pnpm --filter @cherrystudio/dsh-bridge build
pnpm build
```

The bridge runtime is generated under `packages/dsh-bridge/dist/runtime/`; the application build is under `out/`. This does not produce an installer. Rebuild the bridge after changing its plugin, entry list, or dependencies before running the integration tests.

## Example 1: Bridge, Adapter, and Packaging Regression

```sh
pnpm --filter @cherrystudio/dsh-bridge exec tsc --noEmit
pnpm --filter @cherrystudio/dsh-bridge test
pnpm exec vitest run --project main src/main/ai/runtime/dsh/__tests__
pnpm exec vitest run --project scripts scripts/__tests__/dsh-runtime-packaging.test.ts
pnpm lint
```

These suites cover approval and cancellation, missing-workspace denial, session workspace mismatch, stream and trace projection, developer-role compatibility against a local HTTP fixture, real PNG processing through the bundled attachment API, runtime packaging rules, SDK dependency-graph exclusions, and normalized fail-closed plugin settings. They do not include end-to-end current-turn rejection feedback or Full Access shell-parameter probes; verify those scenarios below. The packaging suite does not launch an installed application.

## Example 2: Manual Model and UI Checks

The packaging suite simulates macOS/Linux module loading in fresh Node processes and rejects any resolution of Windows ACL or Win32-process packages. On Windows it also checks that the ACL import graph and runner are covered by `asarUnpack`; a missing ACL package must fail startup rather than disable confinement. Platform simulation is not a native sandbox or installer test.

SDK 0.1.2-rc.1 imports Windows ACL statically from its shared sandbox entry. The bridge build conditionally imports it on Windows, with an import-shape check that fails the build if the SDK changes. Remove this transform when the upstream SDK provides platform-safe loading. Keep the ACL runner and its Win32-process dependency unpacked for the external Node process.

Use an isolated test profile and a disposable workspace. Start the built application with `pnpm start`, select DSH for a test agent, and configure a test model. The following examples can incur model charges; they are not part of the offline suite.

| Scenario | Example input / action | Expected result |
| --- | --- | --- |
| Streaming and cancellation | Ask for a long numbered list; cancel midway | Text streams normally, cancellation ends the turn, and a subsequent message works |
| File approval | Ask to create `upgrade-smoke.txt` containing `hello`; reject approval, then retry and approve | Rejection leaves no file; approval creates it only in the test workspace |
| Rejection feedback | Reject a tool with a reason, then repeat without a reason; separately approve a tool | The next model step receives the rejection reason in the current turn, not as a queued message; approval does not inject rejection feedback |
| Full Access parameters | Request a harmless shell command with paired, unpaired, empty, and repeated escalation parameters; include two calls in one response | Invalid parameters produce corrective tool errors without execution or a forced `blocked` turn; a corrected call and subsequent prompt work. This is not same-mode escalation as a no-op or a general retry limit |
| Plan review | Enable plan mode and ask for a plan to create the file, without implementing it | No write occurs during planning; the review question appears and accepts an answer |
| Cold resume | Complete a short conversation, close the app, reopen that session, and continue | History and workspace remain consistent; no unintended autonomous turn starts |
| Images and MCP | Attach a small PNG; call a test MCP tool that returns text and an image | No missing-export error; text and image references are displayed correctly |
| Skills | Enable a harmless test skill, use it, then disable it | Enabled skill is discoverable; disabled skill is no longer exposed |
| Subagents | Ask a child agent to summarize one test file | Child events and completion reach the parent; cancellation does not leave work running |
| Compaction | Build a short history and invoke `/compact` | Command completes, context usage refreshes, and the next turn still works |

Before adopting an upgraded SDK for existing data, back up the application data and test a **copy** of a session log from the previously shipped version in an isolated profile. Keep the original unchanged; the automated examples do not establish old-log compatibility or rollback safety. Repeat native shell/sandbox checks on Windows, macOS, and Linux before release.
