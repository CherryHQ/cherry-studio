# Agent Note: Bound translation output by requesting body fragments

Status: implemented

English | [中文](2026-11-12-translator-chunks.zh.md)

## Problem

[Issue #24203](https://github.com/CherryHQ/cherry-studio/issues/24203) reports a translation response ending at `max_tokens` with invalid JSON. Its linked run recorded 4096 output tokens but only a partial title in the text block. This establishes truncation, not that source length alone caused that particular response. Sending every body in one request also leaves long translations competing with the echoed original for the same output budget.

## Decision

The trusted inline workflow partitions bodies into at most 2000 Unicode code points per request, preferring newline boundaries and retaining every source character. Requests keep `max_tokens: 4096`, temperature zero and the existing result fields. Multipart requests include the full read-only source and UTF-16 fragment offsets so the model can interpret Markdown, existing translations and email history across boundaries. Only the first fragment can translate the title.

Unchanged fragments retain their source text. Changed fragments retain source boundary whitespace locally, while hard splits without source whitespace preserve newly translated word separators. Single-fragment responses retain their existing handling. Empty results remove fragments selected by the existing cleanup rules. All fragments must succeed before the workflow assembles one translation wrapper and performs one GitHub update. A truncated response fails before text extraction or JSON parsing, naming its fragment index, total and character count, including when no text was returned.

## Alternatives considered

Only improving the JSON error leaves long bodies in one request. Raising the output cap assumes a provider limit and still provides no bound for arbitrary input. Isolated fragments lose the context needed by the existing cleanup rules. Automatic retries add cost without guaranteeing that a provider will produce a complete result; the issue permits an explicit fragment-specific failure instead.

## Consequences

Long bodies require more requests and repeat their full input context. The job timeout increases from five to twenty minutes to allow sequential translation. The character bound is not a token estimate or a guarantee against truncation. Translation and cleanup remain model decisions: full context and fragment instructions preserve access to the necessary information, but deterministic transport tests cannot establish linguistic fidelity, Markdown preservation by a real model, or provider reliability. No partial result is published after a failure.

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/github-content-translator.test.ts` executes the actual workflow script with controlled HTTP responses, covering bounded partitioning, assembly, existing skip paths and failures before GitHub writes. Real provider translation quality is outside this check.
- Regression — Running the first 31 tests against branch commit `26e897859` in an isolated directory produced 16 failures and 15 passes. Two additional translated-word-boundary cases failed before correcting fragment whitespace handling.
