# Agent Note: Cheaper Inference provider

Status: implemented

English | [中文](2026-11-02-cheaper-inference-provider.zh.md)

## Problem

Cheaper Inference users must enter a custom provider URL before connecting their account.

## Decision

Add a named global-edition provider using the existing OpenAI-compatible adapter and the documented `https://api.cheaperinference.com/v1` base URL. Keep API-key authentication required. Discover model IDs through the authenticated `/models?type=text&streaming=true` endpoint at runtime rather than freezing the gateway's changing catalog or prices in the registry. Include official website, documentation, catalog, and dashboard links, the provider name in every locale, and the official light/dark symbols.

## Alternatives considered

- A custom provider works today but requires users to supply the endpoint manually.
- A separate adapter or hardcoded model catalog would duplicate existing transport and discovery behavior.

## Consequences

The generic OpenAI-compatible model fetcher now honors the existing `modelsApiUrls.default` override, preserving its query string and normal key rotation. The icon generator retains the existing manually maintained Radeon Cloud icon while adding the new symbols. Existing adapter, model discovery, and seeding behavior apply unchanged; no database schema migration or credential transfer is involved. Chat Completions is the supported initial transport; other protocols can be added separately with their own validation.

## Verification

- AC1 — Official [documentation](https://www.cheaperinference.com/docs) and [public catalog](https://api.cheaperinference.com/public/models) identify the gateway endpoint and model IDs.

- AC2 — The two model-list URL cases in `src/main/ai/provider/__tests__/listModels.test.ts` pass with isolated Electron/service boundaries: filtered URL, default URL, rotated Bearer authentication, and unchanged model IDs.
- AC3 — Catalog invariants, provider endpoint matrix, registry queries, and provider icon registry suites pass.
- AC4 — Translation validation, bilingual pairing, Agent Note format, and built-in knowledge generation checks pass.
