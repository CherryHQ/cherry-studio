# Agent Note: Release build performance with USB signing

Status: proposed

English | [中文](2026-11-13-release-build-performance.zh.md)

## Problem

The [release workflow](../../../../.github/workflows/release.yml) builds Global and CN on each OS. Every job repeats the full typecheck and JS compilation through [root build scripts](../../../../package.json), then packages both architectures. Windows jobs share one persistent signing machine whose private key is on a USB token accessed through the Windows CSP. Adding runners does not add signing hardware.

The [v2.2.1 run](https://github.com/CherryHQ/cherry-studio/actions/runs/43229565814) provides a diagnostic baseline: its two Windows jobs ran sequentially for about 61.5 minutes in total. Saving the CN pnpm store took 7.95 minutes and restoring it for Global took 6.58 minutes, while installation in each job took less than a minute. The Global macOS job spent about 11 minutes before Vite on typechecking, compared with about 2 minutes 45 seconds for the main, preload, and renderer Vite builds. These are observations from one run, not an estimated speedup. That run predates the current direct-to-COS upload flow; its archive-download delays are not evidence about the current transport.

[T3 Code's release workflow](https://github.com/pingdotgg/t3code/blob/5f85768394f417f5bd098ca7fe4fc41ef07a7cda/.github/workflows/release.yml) separates one JS bundle from platform/architecture packaging. Cherry needs edition-specific bundles and must retain its USB signing chain. This decision owns release packaging optimization; the [CI and local validation proposal](2026-10-01-ci-and-local-validation.md) continues to own validation selection and scheduling.

## Proposal

### Measurement and release trust

Measure from release-run creation until the complete validated draft inventory is ready, including runner queue and setup time. Report environment-approval waiting, publication, and GitCode synchronization separately. Use Actions job/step timestamps first; add named timing spans inside build hooks only where those timestamps cannot distinguish native preparation, signing, notarization, and installer generation. Record success/failure, source SHA, workflow SHA, run attempt, runner type, platform, architecture, edition, cache state, artifact sizes, and runner minutes. Missing timings remain unknown rather than zero.

Preserve exact-source successful CI, branch/tag leases, complete inventory validation, the release Environment approval, and publication revalidation. Build inputs remain checked out at `expected_sha`; trusted release-control scripts remain pinned to the workflow SHA. A release source without the required build interface is reported as unsupported before expensive work, never supplemented with application code from main.

### First implementation layer: local store and build separation

The persistent Windows signing runner uses its local pnpm store without Actions store restore/save. It still runs a frozen-lockfile install with existing dependency policies and lifecycle scripts. The existing clean input can remove node_modules without discarding the store. Hosted macOS/Linux cache behavior remains unchanged in this layer. Source output directories are cleared before compilation so a warm checkout cannot contribute stale files.

Separate compile-only and package-only release entry points while preserving the checked development build commands. Formal release jobs use the successful exact-source CI result instead of rerunning the full typecheck. Preview and nightly workflows keep their current validation contract until deliberately migrated; they do not acquire an implicit typecheck bypass.

### Second implementation layer: edition bundles and parallel targets

Build Global and CN JS once each on Linux, including main, preload, every renderer entry, and utility-process entries. Audit build-time platform-dependent resolution before enabling reuse; platform decisions required at runtime must remain runtime decisions. Each bundle carries source SHA, edition, version, and a digest inventory. Packaging consumes only the matching successful bundle from the same run. It rejects a missing, altered, or mismatched bundle and never recompiles silently. Sentry debug identifiers and sourcemaps are generated and uploaded by the corresponding bundle job, preserving the existing upload failure policy.

Keep native modules, external production dependencies, speech helpers, Computer Use runtimes, and binary selection in target-specific preparation. Do not distribute a builder's node_modules as a portable application dependency tree. Cache immutable unsigned native outputs only when their inputs include source, patches, lockfile, Electron version/ABI, OS, architecture, toolchain, and Linux compatibility requirements. A miss rebuilds or uses the existing verified download path; a cache hit must pass the existing target/artifact checks. Signed applications and successful validation results are not native cache entries.

Split macOS and Linux packaging into edition/architecture jobs, using one hosted runner type per OS and the existing cross-architecture toolchain. Enable QEMU for Linux ARM64 Docker addon builds. Retain Linux GLIBC requirements and pinned native-artifact verification. Windows keeps one job per edition, preparing and packaging its two architectures sequentially on the USB signing machine. Internal Windows binaries are signed before installer creation; setup and portable containers are signed afterward. macOS keeps signing, notarization, and stapling before distribution.

Each target publishes an independent run/attempt/edition/platform/architecture inventory. An aggregation step merges the selected targets into the existing edition/platform contract consumed by [release selection](../../../../scripts/release/select-release-upload.js) and [COS assembly](../../../../scripts/release/release-cos.py). Conflicting filenames fail rather than overwrite. Updater manifests are merged by edition and platform with both architectures' file URLs, hashes, and sizes verified. Failed or missing targets prevent a complete draft. Single-platform repair retains the existing same-SHA baseline rules; sync-only consumes the recorded inventory without building. Finish by updating the [release runbook](../../../../docs/dev/contrib/release-workflow.md).

### Rollout and optional Windows experiment

Deliver the first and second layers separately and compare complete successful runs with the same source, target inventory, signing policy, and matched runner/cache conditions. Report cold and warm results separately, including queue time and runner minutes; repeat comparable observations before claiming a sustained gain. No numerical speedup is promised from the historical sample. Any inability to run signed package, install, or update checks remains an explicit unverified AC rather than a passed local test.

After those measurements, retain one Windows runner unless Windows still determines draft readiness and the machine has spare capacity. Installing a second runner is a separate operational decision, outside the implementation ACs below. Such an experiment requires separate runner/work directories, a machine-wide lock around USB signing, and equivalent total-time/signature/install/update checks. Cloud signing, exporting the USB key, and Linux Windows-signing migration are outside this proposal.

## Alternatives considered

- Add two Windows runners immediately. Defer: CPU/disk contention and USB/CSP behavior are unmeasured, while redundant cache transfer and typechecks are established costs.
- Move Windows signing to Linux as T3 Code does. Reject for this scope: the current USB/CSP signing arrangement must remain usable.
- Remove checks globally or reuse a green result from another SHA. Reject: only the exact-source formal-release CI gate replaces repeated typechecking.
- Share one bundle across editions or copy node_modules across platforms. Reject: edition configuration and native/runtime dependencies have different owners.
- Split architecture jobs without changing inventories. Reject: current COS edition/platform records and shared updater filenames can overwrite each other.
- Change package manager, compression, or distributed build framework first. Defer until measurements identify an additional bottleneck.

## Acceptance criteria

- AC1 — Each selected target reports setup/build/upload timing and context, and draft readiness is distinguished from approval waiting, publication, and synchronization; unavailable phases are explicit. (verification: workflow run summaries and timestamp fixtures; owner: release performance reporting)
- AC2 — A formal release with failed or absent exact-source CI, a moved release ref, an incomplete inventory, or missing publication approval cannot publish; no application build input is taken from another SHA. (verification: focused release workflow tests and release-control run inspection; owner: release control)
- AC3 — Windows completes frozen-lockfile installation with a warm local store without Actions pnpm-store transfers, and clean mode still rebuilds a valid dependency tree. (verification: cold/warm signing-runner logs and clean-mode run; owner: Windows packaging)
- AC4 — Formal release compilation omits duplicate full typechecking while development, preview, and nightly retain their declared validation behavior; cleared outputs contain only the current build. (verification: focused entry-point tests and build logs; owner: release build entry points)
- AC5 — Each edition compiles JS once per run; packaging rejects missing, modified, or wrong-source/edition bundles, and packaged errors resolve through the corresponding uploaded sourcemaps. (verification: bundle integrity tests, target package launch checks, and symbolicated test error; owner: JS bundle pipeline)
- AC6 — Native cache reuse cannot cross incompatible source/toolchain/ABI/OS/architecture/compatibility inputs, and both cold and warm paths produce loadable target-native artifacts. (verification: cache invalidation tests and native load checks on target systems; owner: native packaging)
- AC7 — Parallel macOS/Linux target jobs produce the full existing release inventory without collisions; each edition's merged updater manifests retain valid entries for both architectures, and partial repair/sync-only preserve their contracts. (verification: focused inventory/COS tests and all-platform plus single-platform repair runs; owner: release aggregation)
- AC8 — Both editions retain signed Windows internal binaries and installers, notarized/stapled macOS apps, and working installation, startup, utility processes, and update selection for every supported target. (verification: signature/notarization checks and packaged install/launch/update scenarios; owner: platform packaging)
- AC9 — Comparisons identify source, outputs, runner/cache conditions, complete successful duration, queue time, and runner minutes for cold/warm runs; the runbook matches delivered behavior and unverified platform evidence stays explicit. (verification: comparable workflow reports and documentation gate; owner: release maintainers)

## Risks

A Linux-generated JS bundle may embed a build-host-specific resolution; portability must be established before sharing it. Native caches can retain incompatible binaries if any input is omitted. More parallel jobs can increase setup cost, queueing, and runner minutes. Architecture splitting creates shared updater and COS inventory ownership that must be resolved before enabling parallel uploads. USB/CSP access and Apple notarization remain external constraints. New release entry points must reach the intended release source before the control workflow relies on them. Historical timings cannot establish a gain for the current COS transport or a different runner configuration.
