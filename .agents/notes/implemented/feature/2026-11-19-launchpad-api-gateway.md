# Agent Note: Launchpad access to the unified API gateway

Status: implemented

English | [中文](2026-11-19-launchpad-api-gateway.zh.md)

## Problem

The gateway's Settings entry is deep and cannot be pinned. Developers need quick access to its controls while the Device Connections path remains available.

## Decision

The launchpad includes an `api_gateway` tile that opens `/app/api-gateway` and can be pinned through the existing sidebar shortcut mechanism. The page and Settings share the gateway control panel; the Settings shell and Device Connections link remain in place. Existing preferences, commands and translations provide its behavior.

## Alternatives considered

A permanent sidebar entry or promotion in Settings adds another persistent navigation surface. Duplicating the controls risks divergence; importing a Settings page across pages violates renderer boundaries. A mini app, auto-pinning and a one-time guide add unnecessary machinery or change preferences without a user choice.

## Consequences

The shared panel retains gateway status, address, port, credentials and start/stop controls on both paths. Tab behavior follows existing navigation rules. The same change removes `.agents/notes/proposed/feature/2026-11-19-launchpad-api-gateway.{md,zh.md,i18n.yaml}`.

## Verification

- AC1 — src/renderer/pages/launchpad/__tests__/LaunchpadPage.test.tsx: catches a missing gateway tile or incorrect destination.
- AC2 — src/renderer/components/__tests__/ApiGatewayPanel.test.tsx: catches broken start/stop actions, address display and key masking.
- AC3 — tests/e2e/smoke/launchpadApiGateway.test.ts: exercises pinning, sidebar navigation and launchpad retention after unpinning.
- AC4 — src/renderer/pages/apiGateway/__tests__/ApiGatewayPage.test.tsx: catches a blank stopped panel or missing start action.
- AC5 — tests/e2e/smoke/launchpadApiGateway.test.ts: exercises the Device Connections link and Settings panel.
- AC6 — tests/e2e/smoke/launchpadApiGateway.test.ts: exercises light and dark views in a short, narrow window and records a dark screenshot.
