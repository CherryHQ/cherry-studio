# Agent Note: Local embedding fixtures for E2E

Status: implemented

English | [中文](2026-11-16-e2e-embedding-mock.zh.md)

## Problem

Knowledge regression and authenticated on-demand QA depended on an external embedding URL, key, and model. Network availability and credentials affected checks of application indexing, retrieval, and persistence.

## Decision

`scripts/e2e/regression/embeddingMock.ts` provides a loopback OpenAI-compatible embedding endpoint with a free port. A regression worker owns the service across application restarts; on-demand QA owns it for the authenticated run and closes it during cleanup, including failures. Persisted regression providers are repointed when a replacement worker receives a new port.

Each input receives its own deterministic 64-dimensional vector. Known regression queries and their source chunks share a canonical topic, while unrelated inputs retain distinct vectors. The implementation reuses aiMock's response builder and deterministic vector generator. It avoids the built-in embedding fixture handler because that handler repeats one vector across an entire batch.

Embedding environment configuration is removed from both controllers and workflows. Chat and CherryIN configuration retain their existing behavior. Knowledge tasks still require configured chat responses and remain outside the chat mock task whitelist. Regression annotations and on-demand JSON/Markdown reports identify the embedding mock boundary.

## Alternatives considered

- Retain external embedding credentials: preserves provider integration coverage but retains network and credential dependencies.
- Return one constant vector: cannot distinguish source chunks from unrelated content.
- Switch all knowledge traffic to chat mock mode: also needs chat fixtures and changes a separate boundary.

## Consequences

These tests exercise real application indexing, retrieval, persistence, and citations with synthetic similarity. They do not establish embedding model quality. Unrecognized on-demand text receives deterministic vectors without semantic guarantees.

## Verification

- Regression — Focused tests exercise the endpoint through the AI SDK, comparing source and distractor similarity for English and Chinese retrieval fixtures across batched and single requests. They also check invalid requests, stable repeated vectors, and listener cleanup. Configuration tests verify that external embedding credentials are unnecessary. A local macOS run of the ten knowledge E2E cases passes eight cases. K-01 and MP-66 pass indexing, recall, and their restart checks, then fail at chat responses because the configured chat API key is invalid; answer and citation acceptance remains unverified. The run omits external embedding environment variables and cleans up its owned Electron instance.
