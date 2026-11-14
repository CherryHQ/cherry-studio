# Agent Note: CherryIN model endpoint refresh

Status: implemented

English | [中文](2026-11-14-cherryin-model-endpoint-refresh.zh.md)

## Problem

CherryIN model discovery reads `supported_endpoint_types`, but initialization and manual model pulls skip existing rows. A server protocol change therefore leaves saved models routing to stale endpoints.

## Decision

An application-managed main-process service refreshes the built-in CherryIN provider's existing model endpoints. The first check runs 30 seconds after startup, followed by six-hour checks. A persisted last-attempt timestamp also throttles requests across restarts, failures, and empty responses. Missing or disabled providers, missing enabled credentials, and empty local model lists do not initiate a request or advance this timestamp.

The server owns endpoint values and order; no source field or database migration is introduced. Previously saved and subsequently manually changed endpoint values are both replaced when the server supplies recognized, non-empty endpoints for the exact model ID. Other model settings and membership are preserved. A missing model, empty endpoint declaration, unknown-only declaration, empty response, or failed request keeps local data.

Only one request runs at a time. Requests have a 30-second timeout and are aborted on shutdown. Provider configuration is checked again before applying the response, and current local models are re-read so deleted rows are not recreated. The existing atomic model batch update commits changes before model-query invalidation. Active generation requests are not retried.

## Alternatives considered

Recording server-versus-user endpoint provenance would preserve manual overrides, but adds a persistent ownership contract the requested behavior does not need. The chosen contract explicitly makes the server authoritative. A remote registry update alone cannot replace saved endpoint overrides. Reusing model-list reconciliation would introduce unwanted model additions or removals.

## Consequences

Endpoint changes converge during an eligible scheduled check without an application upgrade. Manual endpoint changes last until the next successful refresh. Newly supported protocol implementations still require an application upgrade. Disabled or newly configured providers become eligible on the next scheduled check; there is no settings watcher or request-time network dependency.

## Verification

- Regression — `src/main/services/__tests__/CherryInModelSyncService.test.ts`: uses a real database with production migrations to verify existing-model routing changes, eligibility, preserved settings and membership, restart throttling, empty/failing responses, shutdown, and stale in-flight results.
- Regression — `src/main/ai/provider/__tests__/listModels.test.ts`, `src/main/data/services/__tests__/ModelService.test.ts`, and `src/main/data/__tests__/CacheService.persist.test.ts`: cover the reused model-list normalization, atomic model writes and projections, and persisted scheduling storage.
