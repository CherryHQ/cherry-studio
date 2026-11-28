# Agent Note: Codex approval cancellation on close

Status: implemented

English | [中文](2026-11-28-codex-approval-close-order.zh.md)

## Problem

Closing a Codex session aborts its outstanding approvals. The cancellation replies are asynchronous, so `turn/interrupt` could reach App Server first. A fast interrupt could finish the turn and trigger process termination before App Server received the replies.

## Decision

During close, the Codex session waits for pending server-request replies to be written to stdio before interrupting a turn that is still active. The desktop host keeps its existing one-second grace period before closing the process.

## Alternatives considered

- Increasing the shutdown grace period would leave the reply and interrupt in the same order when App Server finishes the turn quickly.

## Consequences

The replies precede the interrupt on the same stream. A stalled reply still leaves the host free to close the process when the grace period expires.

## Verification

- Regression — `connections.test.ts`: closing with a pending Codex approval produces a cancellation reply before any interrupt. The ACP case still receives its protocol-specific cancellation.
