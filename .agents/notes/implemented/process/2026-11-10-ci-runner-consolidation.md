# Agent Note: Six-runner CI execution

Status: implemented

English | [中文](2026-11-10-ci-runner-consolidation.zh.md)

## Problem

A full CI plan allocates twelve heavy runners. Three main/preload shards and five renderer shards repeat dependency preparation and occupy capacity needed by other runs.

## Decision

Run the complete selected main/preload and renderer groups in one Linux job each, without a shard filter. Basic checks and package tests keep one Linux job each; macOS and Windows keep one native-contract job each. A successful full plan allocates six heavy jobs plus three lightweight classification/aggregation jobs.

Preserve affected-project selection, test inventories, worker limits, and the `basic-checks`, `general-test`, and `render-test` gates. Update gate dependencies and result mappings together when removing the shard job names.

This supersedes only the initial main/renderer shard baseline in the [validation proposal](../../proposed/process/2026-10-01-ci-and-local-validation.md).

## Alternatives considered

- Retain twelve heavy runners: keeps test sharding but repeats six additional environment preparations.
- Consolidate to four or three heavy runners: shares more preparation but serializes more validation work.

## Consequences

Each full run removes six dependency installations and cache restores. Main and renderer tests have less cross-machine parallelism, so elapsed time may increase. Hosted timing remains unmeasured for this configuration.

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` enforces four Linux runners plus one macOS and one Windows runner, unsharded main/renderer commands, and rejection of failed, cancelled, missing, or unexpectedly skipped planned work.
- Regression — `scripts/__tests__/validationPlan.test.ts` covers affected-project selection and group execution independently of CI sharding.
