# Agent Note: Save assistant message edits without model access

Status: implemented

English | [中文](2026-11-25-assistant-message-edit-without-model-access.zh.md)

## Problem

Clicking Send after editing an existing assistant reply left its stored text unchanged when the selected Cherry AI model required sign-in. The composer applied the model-access guard before deciding whether an edit needed a new model request.

## Decision

Save an edited assistant reply in place even when model access is blocked. Editing a user message and resending it still requires access to the selected model.

## Alternatives considered

Requiring users to sign in or switch models before saving a reply would tie local message edits to the availability of a remote model.

## Consequences

People can correct stored replies while signed out or out of quota. New generation and regenerated replies still go through the model-access check.

## Verification

- Regression — `messageEditTyping.test.ts`: the macOS Electron smoke case preserves immediately typed characters and persists the edit while the selected model requires sign-in. Before the fix, the stored reply retained its original text.
