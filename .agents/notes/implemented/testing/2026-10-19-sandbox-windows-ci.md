# Agent Note: Windows sandbox CI without Tier 3 preparation

Status: implemented

English | [中文](2026-10-19-sandbox-windows-ci.zh.md)

## Problem

The Windows Server CI job stalled during MXC Tier 3 system-drive preparation. Upstream closed the related issue while deprecating Tier 3, rather than merging the proposed fix. Maintaining a host-preparation fork would keep Cherry dependent on that path.

## Decision

Windows Server 2025 runs sandbox contract tests without native sandbox setup. Native CLI, Node/Python RPC, Windows boundary and CLI isolation acceptance run on GitHub's hosted `windows-11-arm` image. The job requires Windows 11 24H2+, the actual MXC BaseContainer tier and a ready public probe before execution. No Tier 3 initialization or fallback runs in CI.

Required demo acceptance covers sandbox commands, bidirectional RPC, granted/denied file access, loopback refusal and host ACL preservation/restoration. Detached descendant termination is excluded: the public completion contract reports `tree: unverified`, not a whole-tree termination guarantee. The owner accepts this narrower scope; the native job remains required and does not ignore failures.

The Windows 11 matrix leg participates in the existing required general gate. Contract success on Server cannot substitute for native acceptance.

## Alternatives considered

- Maintaining a patched Tier 3 host-prep binary was rejected by the owner.
- A self-hosted Windows 11 runner is unnecessary while the hosted ARM64 image can be evaluated.
- Skipping native tests on unavailable hosts would hide missing acceptance coverage.

## Consequences

A hosted image without working BaseContainer fails explicitly. ARM64 results do not certify Windows x64 or packaged Electron. The existing Tier 3 setup command remains a legacy experimental tool, not a maintained CI dependency. Changing CI placement does not change runtime tier selection in the adapter. Removing the descendant test does not fix or certify subprocess launch: the hosted BaseContainer fixture reported `spawn node.exe ENOENT` before reaching termination assertions. Subprocess launch and descendant cleanup remain unaccepted on that host.

## Verification

- Regression — `scripts/__tests__/validationPlan.test.ts` exercises platform selection for Windows and macOS, retaining all Windows sandbox contracts while excluding native execution on Server.
- Regression — `scripts/__tests__/validationWorkflow.test.ts` checks that Windows 11 retains native test commands and participates in the required gate without ignored failures.
- Native acceptance — `packages/sandbox/tests/acceptance/windowsHost.test.ts` rejects tiers other than BaseContainer before the Windows 11 CI tests. The hosted run at `f6bc99c2ae8` passed this preflight and 14 CLI/RPC/boundary tests, but failed the descendant fixture during spawn. The separate CLI isolation acceptance step did not run. Removing that test is a scope decision, not evidence that the full native job has passed; a new run is required.
