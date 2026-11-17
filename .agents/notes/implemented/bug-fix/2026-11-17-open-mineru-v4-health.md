# Agent Note: Keep reachable MinerU 4.x deployments selectable

Status: implemented

English | [中文](2026-11-17-open-mineru-v4-health.zh.md)

## Problem

MinerU 4.x returns HTTP 200 from `/v1/health` but renamed capability fields compared with the v1 schema Cherry Studio recognized. The probe classified this live deployment as an invalid response, and connectivity filtering hid Open MinerU from settings.

## Decision

Recognize the v1 health envelope with MinerU 4.x capability field names as a reachable, known MinerU deployment. If its v1 capabilities do not satisfy the parser contract, probe `/health` and use the legacy parser only when that endpoint returns a valid legacy health response. Otherwise keep the engine selectable as unsupported. Unrelated successful responses, including HTML proxy pages, remain invalid.

## Alternatives considered

- Accept any HTTP 200 response as reachable: an unrelated service on the configured port could be presented as MinerU.
- Reject every health response that does not satisfy the parser contract: this hides a live MinerU 4.x deployment and prevents a useful parse error from being shown.

## Consequences

MinerU 4.x deployments using the recognized health envelope remain visible. Deployments with a valid legacy health endpoint can use the existing legacy parser; deployments without a supported parser remain visible but report an unsupported response when parsing is attempted.

## Verification

- Regression — `pnpm test:main src/main/features/fileProcessing/processors/openMineru/__tests__/protocol.test.ts`: recognizes MinerU 4.x health fields, falls back only for a valid legacy health endpoint, and still rejects unrelated responses.
- Regression — `pnpm test:main src/main/features/fileProcessing/__tests__/checkProcessorConnectivity.test.ts`: keeps a live MinerU 4.x deployment selectable while preserving unreachable-host behavior.
