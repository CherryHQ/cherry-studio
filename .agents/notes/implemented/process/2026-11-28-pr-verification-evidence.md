# Agent Note: Require evidence for UI fixes and performance optimizations

Status: implemented

English | [中文](2026-11-28-pr-verification-evidence.zh.md)

## Problem

Reviewers need to see the original and fixed UI behavior and to assess performance claims against measurements. A list of passing checks does not establish either comparison.

## Decision

The [PR template](../../../../.github/pull_request_template.md) defines both requirements under `Verification`. The [creation skill](../../../skills/gh-create-pr/SKILL.md) collects the applicable evidence before a PR is ready for review. An explicitly requested draft can list pending evidence. The [review skill](../../../skills/gh-pr-review/references/pr-review.md) checks the evidence against the reviewed change and reports gaps at the PR level.

## Alternatives considered

- Leaving evidence to reviewer discretion makes requirements inconsistent and delays requests until review.
- Adding a CI gate would require a separate way to assess whether media shows the affected behavior and measurements match the claim.

## Consequences

Authors provide both comparisons when a fix changes visible UI behavior and optimizes performance. Reviewers can report evidence gaps while continuing code review.

## Verification

- Regression — Scoped inspection of the template, creation workflow, and review workflow covers UI-only fixes, performance-only changes, changes requiring both, and missing evidence.
