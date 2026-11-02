# Agent Note: Preserve entered remote connection addresses

Status: implemented

English | [中文](2026-10-22-remote-address-input.zh.md)

## Problem

Saving an HTTP or HTTPS custom address discarded its original spelling. Reopening the dialog displayed a WebSocket URL with an explicit port and route, so users could not recover the address they entered.

## Decision

Store the validated, trimmed input as optional `inputUrl` in the existing advertised endpoint Preference. Save it together with the parsed host, port and security. The selector and dialog use the input for display; older settings without it retain the endpoint URL display.

The gateway validates and publishes only host, port and security. Invitation matching compares those transport fields, excluding display metadata. QR v3 and authenticated endpoint snapshots remain unchanged.

## Alternatives considered

- Persist the input in a second Preference: rejected because separate saves could leave the displayed address inconsistent with the endpoint.
- Add HTTP/HTTPS or display metadata to the shared wire schema: unnecessary for preserving Desktop input and would require another Mobile protocol update.

## Consequences

Existing settings need no migration. Newly saved settings preserve scheme, hostname spelling, explicit ports and accepted path spelling after trimming surrounding whitespace. Validation, listener configuration and pairing authorization are unchanged. Clearing the override removes both the input and endpoint together.

## Verification

- Regression — `DeviceConnectionsSettings.test.tsx`: HTTP/HTTPS input persists and reopens unchanged, the selector uses it, QR endpoints remain compatible, clearing restores automatic addressing, and old settings still open.
- Regression — `ApiGatewayService.test.ts`: invitation endpoints omit `inputUrl`, while invalid persisted destinations remain rejected.
- Regression — Real Electron: HTTP and HTTPS inputs remain unchanged after saving and reopening; the HTTP selection also survives a renderer reload.
