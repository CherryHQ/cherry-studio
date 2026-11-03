# Agent Note: Relay transport for paired devices

Status: proposed

English | [中文](2026-11-04-remote-relay.zh.md)

## Problem

Paired phones cannot reach a desktop without a reachable direct address. The existing pairing interface and session lifetime also assume a running LAN listener.

## Proposal

The user approved implementation of the reviewed Relay integration plan in the current task. This note records that scope; it does not claim a GitHub Spec review or completed device acceptance.

Add an outbound Relay connection under the existing remote-access lifecycle. Both direct and Relay streams use the same Noise identity, pairing approval and grants. Keep the LAN switch independent. Store one host key per Relay origin in Main, never in the invitation or phone. Extend invitations with QR v4 and an optional Relay address; retain v2/v3 decoding and connection endpoint capability version 1.

The Relay runtime owns temporary rendezvous and encrypted byte forwarding. Account credentials, a device registry, WebRTC, push and billing are outside this change. The mobile connection manager remains the single owner of direct/Relay selection and reconnection.

## Alternatives considered

- Requiring LAN access for Relay leaves pure Relay pairing unavailable.
- Separate RPC or authentication implementations would split pairing and revocation ownership.
- Putting Relay URLs in direct addresses loses target identity and silently breaks older readers.

## Acceptance criteria

- AC1 — QR v2/v3 remain readable and v4 expresses a Relay-only target without carrying the host key (verification: shared protocol tests)
- AC2 — Direct and Relay streams share endpoint identity, pairing and authorization; disabling LAN only closes direct sessions (verification: main service tests)
- AC3 — Relay reconnects retain their target and cancellation releases waiting connections without replaying business commands (verification: runtime and connector tests)
- AC4 — Real Electron and iOS/Android complete cross-network pairing, binary transfer, restart recovery and revocation with bounded slow-reader buffering (verification: device acceptance)

## Risks

Relay packages must be released before ordinary registry installs can consume them. Local tarball validation is separate from publication. Mobile native send-buffer support and OS suspension require device acceptance; a passing Bun suite does not establish them.
