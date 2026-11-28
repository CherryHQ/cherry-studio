# Agent Note: Keep a manually started OpenClaw gateway running

Status: implemented

English | [中文](2026-11-28-openclaw-manual-gateway.zh.md)

## Problem

Opening Agent Services can start an ACP discovery check against the OpenClaw gateway. Releasing its lease used to stop the gateway even when the user had started it for the WebUI.

## Decision

Record an explicit start on the gateway process. ACP leases reuse that process and leave it running when the last lease closes.

## Alternatives considered

- Skipping the settings probe would still leave the same shutdown behavior when a chat session releases its lease.

## Consequences

Gateways started for ACP sessions still stop after the last lease. Users can end an explicitly started gateway through **Stop service**. The record clears when the process exits.

## Verification

- Regression — `pnpm test:main src/main/services/__tests__/OpenClawService.test.ts`: the ACP lease closes while the explicitly started process stays alive, and an explicit stop ends it.
