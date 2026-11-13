# Agent Note: Publish sanitized regression evidence before smoke

Status: implemented

English | [中文](2026-11-08-e2e-report-checkpoint.zh.md)

## Problem

Regression evidence was uploaded only after standalone smoke, which can run for up to an hour. This delayed diagnosis of completed regression failures. Cancelling a superseded workflow could prevent its final artifact upload.

## Decision

When a branch `all` run has successfully verified its smoke build, finalize and upload a regression checkpoint before starting smoke. Both checkpoint steps are optional. Upload requires the finalizer's successful `outcome`, including when a failed step has a tolerated success `conclusion`.

Checkpoint and final reporting use the same credential-redaction environment, public evidence roots and artifact name. Final reporting overwrites the checkpoint only after its own finalizer succeeds. Final report generation, platform validation and aggregate validation remain mandatory; a checkpoint cannot establish smoke acceptance.

## Alternatives considered

- Cancelling a workflow to obtain its final reports does not reliably preserve artifacts.
- Uploading raw runtime directories would bypass the existing redaction and private-path boundary.
- A separate checkpoint artifact would preserve intermediate evidence independently, but would add another artifact lifecycle and aggregation contract.

## Consequences

Completed regression evidence can be inspected while smoke continues. An unavailable checkpoint does not fail an otherwise valid run; final reporting and all test gates retain their failure behavior.

The upload action's [overwrite option](https://github.com/actions/upload-artifact/blob/main/README.md#inputs) deletes the old artifact before uploading its replacement. A failed or cancelled final replacement can therefore lose the checkpoint. This change improves early access without guaranteeing artifact retention during replacement.

## Verification

- Regression — `pnpm exec vitest run --project scripts scripts/e2e/regression/__tests__/reportBundle.test.ts` passes seven checks. Outcome/cancellation truth tables reject uploads after failed sanitization despite a tolerated success conclusion; explicit redaction inputs and public upload roots remain consistent.
- Regression — the same suite executes the real aggregate gate shell with a successful regression-command stub and proves failed or cancelled test jobs still fail. Hosted checkpoint availability and final replacement remain part of the complete workflow rerun.
