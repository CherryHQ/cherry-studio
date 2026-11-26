# Agent Note: Clear unsent attachment selections on disconnect

Status: implemented

English | [中文](2026-11-26-remote-attachment-disconnect.zh.md)

## Problem

A phone could upload a file to an Agent conversation and disconnect before sending it. The desktop continued showing the pending card until the selection expired or the app restarted. [Issue #25303](https://github.com/CherryHQ/cherry-studio/issues/25303)

## Decision

Record the connection generation that last presented each selection. When the connection closes, remove its unsent selections and notify renderers watching the affected conversations. A selection already associated with a send command stays available for the handoff to its committed message.

## Alternatives considered

- Clearing all selections for the device would also remove those that a reconnected client had already presented.
- Canceling staged uploads would interfere with file transfer recovery. The accepted issue calls for automatic cleanup of the pending card.

## Consequences

Reconnecting clients can present the same upload again. The file service owns its bytes and the command receipt owns the association with the sent message.

## Verification

- Regression — The remote Agent RPC regression presents a ready attachment and checks the desktop selection list after disconnect. The managed-file case checks that a sent selection still identifies its persisted message. The renderer test confirms the pending card disappears once the committed message is visible.
- Regression — The presence service regression closes the older of two connections sharing a device. It checks the surviving selection and the session-specific IPC notification.
