# Agent Note: Run desktop regression and standalone smoke in parallel

Status: proposed

English | [中文](2026-11-19-parallel-desktop-e2e.zh.md)

## Problem

The [E2E workflow](../../../../.github/workflows/e2e-regression-test.yml) runs desktop regression and standalone smoke serially within each platform job. In [run 44433850484](https://github.com/CherryHQ/cherry-studio/actions/runs/44433850484), Windows spent approximately 76 minutes on regression phases and another 31 minutes on smoke. The [regression checkpoint](../../implemented/testing/2026-11-08-e2e-report-checkpoint.md) lets readers see regression evidence early, while smoke still waits for regression cleanup.

## Proposal

Resolve the test ref and suite selection once. For a branch, build the application once per platform from that resolved SHA. Publish the main, preload, renderer, and utility-process bundles together, with the target SHA, platform, architecture, and Node/Electron versions. Each selected suite starts on its own runner after the platform builds are ready. Consumers verify the artifact identity against the resolved checkout and install dependencies, native modules, and runtime tools in their own directories. Preserve executable bits and bundled files required by the application, and keep machine-local package trees, credentials, signing material and profiles out of the build artifact.

Keep desktop regression's phase order, tasks, strict provider fixtures, native prerequisites, release-install flow, and controller-owned cleanup. Keep standalone smoke's own Playwright configuration, per-test profiles, platform coverage, and zero CI retries. Preserve `suite=all` as the branch default, honor `suite=regression` and `suite=smoke`, and apply `task` to desktop regression only. Release tags still run regression against the published installer without a branch build.

Upload finalized, sanitized desktop regression evidence as soon as each platform finishes, independently of smoke. Use separate suite/platform artifact identities and keep their public evidence allowlists. The final report collects exactly the expected suite/platform combinations and preserves the existing regression HTML and smoke links. A required failed, cancelled, skipped, or missing result blocks the final verdict. Keep available failure evidence inspectable. A partial retry may reuse validated reports from unchanged successful jobs in the same workflow run, while failed or missing results cannot be satisfied by older artifacts.

## Alternatives considered

- Run both suites on the same runner: native focus, global shortcuts, local ports, and app process ownership would be shared.
- Build independently in each suite job: simpler transport, but duplicates compilation and weakens proof that both suites ran the same build.
- Run smoke after regression with only an early checkpoint: exposes regression evidence quickly but keeps smoke on the serial path.

## Acceptance criteria

- AC1 — One branch run with `suite=all` produces one build per platform and four independently scheduled suite jobs that verify the correct build identity. Both suites retain their pre-change case inventories and platform eligibility. (verification: workflow contract tests and hosted macOS/Windows run; owner: E2E workflow maintainers)
- AC2 — `regression` and `smoke` each allocate only their selected suite jobs, scheduled runs select both suites, and release installer regression reaches both platforms without a branch build. (verification: workflow contract tests and hosted selection checks; owner: E2E workflow maintainers)
- AC3 — A finished platform's sanitized regression report is downloadable while smoke is still running, and the aggregate combines the required reports when they arrive. Failure, cancellation, or an absent expected result blocks the aggregate verdict. (verification: report and gate tests plus hosted artifact observation; owner: E2E reporting maintainers)
- AC4 — Matched runs record wall-clock time, runner minutes, artifact size and transfer time at the same application SHA and task selection. (verification: hosted before-and-after comparison; owner: E2E workflow maintainers)

## Risks

Two suite runners per platform increase peak concurrency and repeat workspace-local setup. Measure the cost of build transfer and native preparation alongside elapsed time. Runner architecture or ABI differences can break startup even when the source SHA matches. Treat a build identity mismatch as a setup failure. A stable test verdict still depends on native desktop behavior on both hosted platforms.
