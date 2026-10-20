# Agent Note: On-demand desktop QA

Status: proposed

English | [中文](2026-10-20-on-demand-qa.zh.md)

## Problem

[Issue #22055](https://github.com/CherryHQ/cherry-studio/issues/22055) needs one temporary UI check on one hosted platform without adding a regression-manifest case or waiting for a code PR. The current [regression controller](../../../../scripts/e2e/regression/README.md) selects existing tasks but always dispatches macOS and Windows. Its scenario setup also forces English, which would invalidate QA's Chinese selectors.

QA consumes results mechanically and writes them to a tracking table. A failed assertion, incomplete installation, unavailable application, wrong language, and canceled job must remain distinguishable. A failure category identifies the execution stage; it is not evidence that a product defect has been confirmed.

## Proposal

### Dispatch and ownership

Add `.github/workflows/qa-ondemand.yml`, with the controller in `scripts/e2e/ondemand/` and reviewed code scenarios in `tests/e2e/ondemand/specs/`. Ship the default smoke as a JSON plan, not a code scenario. QA owns temporary input plans; development owns the controller and reviewed code scenarios. The initial delivery includes smoke and a temporary-plan example, not tray, upgrade, or Linux scenarios.

| Input | Contract |
|---|---|
| `platform` | `windows` or `macos`; default `windows`; use only the selected `windows-2022` or `macos-latest` runner. |
| `mode` | `branch` or `tag`; default `branch`; must match the resolved ref kind. |
| `ref` | A branch in this repository or a `v*` release tag; default `main`; resolve to an exact commit. |
| `spec` | Default `smoke`; require `^[a-z0-9][a-z0-9-]{0,40}$`; reject invalid names instead of rewriting them. |
| `plan` | Optional JSON, at most 10,240 UTF-8 bytes before parsing; longer flows require a reviewed code scenario. |
| `timeout_minutes` | Integer, default 45; branch runs require 15–360, tag runs 1–360. Explain branch preparation cost when rejecting a smaller timeout. |

Validate inputs in the resolve job before allocating the target-platform runner. With a plan, execute its steps and use `spec` only as the report name; no matching file is required. Without a plan, `smoke` loads the bundled JSON template; other names load their reviewed code scenario. The 10 KiB limit is this tool's policy, separate from GitHub's dispatch payload limit.

Normal dispatch selects the workflow from `main` and the tested application through the input `ref`. Pin the controller to the workflow SHA and the application to the resolved target SHA, recording both. Pinning provides reproducibility; explicitly dispatching a workflow from another branch still selects that branch's controller. The test job uses concurrency group `qa-ondemand-<platform>-<spec>`, `cancel-in-progress: false`, and `queue: max`; all pending requests are retained and serialized, not deduplicated.

### Runtime preparation and readiness

Reuse trusted-ref resolution, isolated paths, installation, process ownership, lifecycle, and Windows CDP preparation from the existing controller. Extract the shared release-preparation function from its CLI. Keep on-demand state and results independent; call the lower-level functions directly instead of inventing a regression task or initializing `startup-smoke`. Do not install unrelated code tools or execute regression phases.

Branch mode prepares application dependencies, binary downloads, Electron native dependencies, and the utility-process build. Tag mode downloads and installs the matching release. On Windows, retain synchronous waiting for the NSIS `/S` installer to exit successfully before finding the executable and launching it. A file appearing early does not finish installation. Installation timeout or a nonzero exit is a preparation failure.

Give application readiness a separate 60-second total budget covering CDP availability, the main-window target, and an interactive shell or onboarding surface. Select the owned main window by its path rather than the first CDP page. Add optional readiness/locale arguments to the shared lifecycle without changing existing regression defaults. Ordinary actions and assertions default to 15 seconds. Readiness failure is `APP_NOT_READY`; a later lost application connection is `APP_UNAVAILABLE`.

Stop only the application recorded in the isolated run directory after success, failure, or a cancellation that the controller can handle. Preserve ownership checks and Windows CDP compatibility. A clean-profile smoke accepts onboarding and does not require provider credentials or silently complete onboarding.

### Language and timezone

Chinese is a hard precondition: set workflow `LANG=zh_CN.UTF-8`, launch Electron with `--lang=zh-CN`, and set `app.language` through the existing Preference API. Read the preference back, reload, and verify a Chinese UI marker after normal i18n initialization. Do not reuse English regression setup or treat the static HTML `lang` attribute as the active application language. Verify language before execution, on completion, and during failure capture; a mismatch is an environment failure. A reviewed scenario receives the same Chinese-preparation helper.

Keep the runner's timezone configuration. Record inherited timezone configuration and the actual controller, main-process, and renderer timezones without making their values a default pass condition. A plan may declare `requiredTimezone`, a valid IANA timezone identifier; only then must both application main process and renderer match it. A mismatch or an unreadable required value is an environment failure.

Environment collection and verification use controller-owned fixed code. They never become a plan `script`, `evaluate`, or generic IPC action. Controller `page.evaluate` callbacks may perform fixed, reviewed preference operations and read observations; user input never supplies executable source.

### Plans and scenario execution

Use strict Zod objects for the plan and each step. Require a nonempty `steps` array, reject unknown fields and verbs, and reject path traversal in scenario and screenshot names. Plan options are `continueOnFailure` (boolean, default false) and optional `requiredTimezone`; language is fixed to `zh-CN`.

| Verb | Arguments and behavior |
|---|---|
| `click` | `text`: click an exact visible-text match. |
| `clickRole` | `role`, `name`: click the named accessible role. |
| `fill` | `selector`, `text`: fill the selected input. |
| `key` | `key`: send a Playwright keyboard shortcut. |
| `waitFor` | `selector`, optional `timeout`: wait for visibility. |
| `expectText` | `text`, optional `timeout`: wait for matching visible text. |
| `expectVisible` | `selector`, optional `timeout`: assert visibility with retry. |
| `screenshot` | Optional safe `name`: capture a masked screenshot inside the evidence directory. |
| `sleep` | Optional `ms`, default 1,000: wait a finite, nonnegative duration. |

Use Playwright's existing locators, auto-waiting, keyboard handling, and assertions rather than a custom automation engine. The smoke plan verifies a rendered application/onboarding surface and captures evidence. Reviewed code scenarios use the shared context, step recorder, screenshot function, and Chinese-preparation helper; they cannot return an unchecked passing verdict.

Stop after the first failed step by default and mark remaining steps `not_run`. With `continueOnFailure: true`, continue collecting action/assertion failures. Application exit, connection loss, and controller errors still stop execution. A failure, unexecuted required step, unfinished phase, or empty scenario cannot pass.

### Results and exit codes

Start `results.json` with `schemaVersion: 1`. Its stable top-level fields are `schemaVersion`, `status`, `exitCode`, `failureStage`, `errors`, `metadata`, `environment`, `timings`, `steps`, and `artifacts`. `status` is `passed`, `failed`, or `interrupted`; step status is `passed`, `failed`, or `not_run`. Unavailable observations are null with a reason, not invented values.

| Exit code | Meaning |
|---|---|
| `0` | Preparation, environment verification, all required steps, reporting, and cleanup completed successfully. |
| `1` | A UI action or assertion was not satisfied. |
| `2` | Input, environment, preparation, installation, controller, reporting, or cleanup failed. |
| `3` | The application was not ready or its connection became unavailable during execution. |

Use priority `2 > 3 > 1 > 0` when failures coexist. `failureStage` identifies the stage of the selected failure; keep every original failure in `errors`, including earlier assertions when cleanup later fails. Stages are `input`, `prepare`, `environment`, `ready`, `steps`, `report`, and `cleanup`; a passing result has a null failure stage. The controller, workflow's final verdict step, and JSON agree on the exit code for a normal termination. GitHub job success/failure is not the numeric classification.

Persist the current phase and provisional interrupted result before work starts, updating them as phases advance. A handled signal preserves `status: interrupted` and `exitCode: null` while attempting cleanup and reporting. A hard kill may leave only that last snapshot, or no artifact if the runner cannot upload it. Consumers must combine missing/incomplete evidence with the GitHub cancellation/timeout status instead of fabricating a controller exit code.

`metadata` records workflow/controller SHA, application SHA, ref, and mode. `environment` records runner label, `ImageOS`, `ImageVersion`, OS/architecture, runtime application version, language, and per-process timezones. Read the application version from the running instance; do not substitute the tag or checkout version. `timings` separates preparation, application readiness, and step durations. Preserve reasons when an observation cannot be collected.

Within schema version 1, only add optional fields. Do not delete, rename, change types, or change existing meanings, including enum meanings; incompatible changes require a new schema version. Provide `results.md`, job summary, masked screenshots, and sanitized logs alongside JSON. Never upload the raw plan, credentials, or complete profile. Upload artifact `qa-ondemand-<spec>-<platform>-<sha7>` for 30 days, including available failure evidence, and preserve failure status after upload.

### Approval and Linux follow-up

This is the bottom proposed testing Spec. Under the [Agent Note rules](../../README.md), implementation layers start only after a non-author human maintainer approves the current Spec PR commit. The requesting maintainer arranges that reviewer; the implementation owner supplies the PR URL and exact SHA. Keep this note proposed until the final implementation layer has actual evidence for every acceptance criterion. Development owns implementation and hosted verification; QA accepts the report and dispatch contract.

Record Linux's entry condition in #22055 during this Spec delivery: workflows dispatched from `main` must have Windows branch/main and tag smoke all green over three consecutive running days, with at least one of each mode each day, at least six successful runs total, and complete evidence. Group days by dispatch date in `Asia/Shanghai`. Dates with no smoke dispatch do not count; a running day missing either mode cannot count or be skipped. Related failures or cancellations reset the streak; pending runs and incomplete evidence do not satisfy it. Controller SHAs may change and remain recorded per run. When the condition is met, Linux becomes the next development item, including platform handling, AppImage installation/launch, display setup, process management, and separate acceptance. This is an entry condition, not a claim that adding one platform constant completes Linux support.

## Alternatives considered

- Extend the regression task manifest for every temporary test: rejected because it requires a code PR and retains the two-platform matrix.
- Execute supplied JavaScript or shell commands: rejected because reviewed workflow code does not make arbitrary input code safe.
- Add a top-level `qa/` tree and duplicate installation/process control: rejected in favor of existing test/controller placement and ownership helpers.
- Force timezone configuration on every hosted VM: rejected because ordinary Chinese UI checks do not depend on it; make explicit timezone requirements verifiable instead.
- Classify failures from logs or job success alone: rejected because QA needs a versioned machine-readable execution result and must distinguish interruption.
- Hold Linux until three rounds use one unchanged controller SHA: rejected because unrelated changes would indefinitely reset otherwise valid evidence.

## Acceptance criteria

- AC1 — A valid dispatch selects exactly one Windows/macOS runner and one test; invalid platform, mode/ref mismatch, spec name, timeout, JSON, or a plan above 10,240 UTF-8 bytes is rejected before target-runner allocation. (verification: unit + workflow contract; owner: development)
- AC2 — A temporary plan with no matching scenario file runs without a code change; the default smoke uses JSON, and other no-plan names select only their reviewed code scenarios. (verification: unit + Electron; owner: development)
- AC3 — Controller and application SHAs are pinned separately, and branch/tag preparation reuses owned isolated processes without running unrelated regression phases or installing unrelated CLIs. (verification: unit + workflow contract + Electron; owner: development)
- AC4 — An installer that creates the executable before exiting cannot trigger launch early; installer failure/timeout returns preparation code 2, and the owned process is cleaned up on completed runs. (verification: unit + packaged artifact; owner: development)
- AC5 — Wrong application language fails environment validation with code 2; Chinese markers are verified after preference application, without interpreting a static HTML language tag as proof. (verification: unit + Electron; owner: development)
- AC6 — Timezone differences do not fail ordinary plans; an explicit required timezone fails with code 2 when either application process differs or cannot be inspected. (verification: unit + Electron; owner: development)
- AC7 — An application missing its independent 60-second readiness budget returns code 3, while a normal unsatisfied 15-second action/assertion returns code 1; controller-provided environment checks accept no executable plan input. (verification: unit + Electron; owner: development)
- AC8 — Strict plans reject unknown fields/verbs, empty steps, and traversal; default failure stops and marks later steps not_run, while continueOnFailure collects later failures without allowing an incomplete or failed run to pass. (verification: unit + Electron; owner: development)
- AC9 — Version-1 reports retain their stable fields, distinguish runtime environment and application version, separate preparation/readiness/steps, and select exit codes by 2 > 3 > 1 > 0 while retaining all failures. (verification: unit + report contract; owner: development)
- AC10 — Forced interruption is represented by null exitCode and interrupted status when evidence can be saved; missing evidence plus a canceled/timed-out job never becomes a passing or fabricated controller result. (verification: unit + workflow contract; owner: development)
- AC11 — Completed Windows/macOS branch/tag smoke and temporary-plan acceptance runs provide downloadable 30-day JSON/Markdown, masked screenshots, sanitized logs, and summaries without raw plans, credentials, or profiles. (verification: packaged artifact + Electron; owner: development with QA acceptance)
- AC12 — Same-platform/spec requests retain pending work without canceling active runs, and #22055 records the three-running-day Linux entry condition with per-run SHAs and complete evidence requirements. (verification: workflow contract + docs gate + issue readback; owner: development)
- AC13 — The bilingual Spec passes documentation/pairing checks, and no implementation layer starts before a non-author human APPROVED review matches the current Spec head. (verification: docs gate + GitHub review; owner: development and requesting maintainer)

## Risks

- Branch preparation remains expensive; one test does not promise a complete job in a few minutes. Image drift and cold startup must remain visible in provenance and timings.
- A 60-second readiness budget can expose slow or broken startup; code 3 identifies the stage without deciding whether the cause is product or environment. Older releases missing required Preference/runtime interfaces fail explicitly rather than receiving v1 compatibility shims or fabricated observations.
- Screenshots and application logs can contain entered secrets. Reuse the existing masking/redaction helpers, keep traces disabled for credential-bearing work, and limit uploaded paths.
- Cancellation can kill the controller before cleanup or upload. Provisional snapshots and GitHub terminal state bound the claim; complete evidence cannot be guaranteed after a runner hard kill.
- Serialized requests still consume total runner time, and `queue: max` has GitHub's finite queue capacity. A queued request is not completed acceptance evidence.
