# Agent Note: CherryAI subscriptions through the public gateway

Status: implemented

English | [中文](2026-11-11-subscription-public-gateway.zh.md)

## Problem

CherryAI subscription models could be routed internally, but a separate public model filter hid and rejected them for external clients and Code Mate.

## Decision

Public model eligibility uses the existing gateway routing predicate. Enabled subscription chat models appear in the model list and Code Mate picker and accept external requests. The existing Cherry Cloud provider checks current model entitlements and sends requests with the signed-in account; the server enforces subscription quota. Gateway authentication remains required.

## Alternatives considered

- Keep subscriptions internal-only: this prevents the requested external-client use.
- Export account credentials to clients: unnecessary because the provider already owns authenticated requests.

## Consequences

Clients with the gateway key can consume the signed-in account's subscription quota. Non-chat models, disabled providers/models and the managed default model retain their existing restrictions. External requests do not gain internal Agent usage attribution or internal request privileges.

## Verification

- Regression — `src/main/features/apiGateway/utils/__tests__/models.test.ts`: subscription models are eligible, listed and resolved; unsupported models remain excluded.
- Regression — `src/main/ai/provider/__tests__/cherryCloud.test.ts`: managed authentication, entitlement failures and server quota responses retain their existing behavior.
- Regression — `src/renderer/pages/code/hooks/__tests__/useConfigMetadata.test.ts`: subscription models are selectable through the gateway.
