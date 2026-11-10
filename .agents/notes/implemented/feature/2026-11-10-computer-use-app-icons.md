# Agent Note: Display the operated app on Computer Use tool calls

Status: implemented

English | [中文](2026-11-10-computer-use-app-icons.zh.md)

## Problem

Computer Use MCP calls identify a tool but do not show which application it operated. Inferring that identity from the foreground window can label a background operation incorrectly.

## Decision

Read the producer's `com.cherrystudio.computer-use/app` MCP `_meta` entry. The producer resolves the actual target and supplies a name, optional bundle identifier and optional 64×64 PNG. Validate the name, PNG MIME type and base64 payload with a 65,536-character bound before displaying it through the shared Avatar component. Preserve tool content and use a named fallback when the icon is missing or cannot load.

Claude Code preserves message-scoped MCP metadata only when exactly one tool result can own it. Live observations and native archive recovery use the same association rule. The desktop decorator converts screenshot blocks independently of the app icon.

The pinned Pi SDK patch retains MCP `_meta` in host-only tool details while continuing to exclude it from code-mode structured results and model content. The Pi desktop decorator reads those details; native execution, discovery and teardown remain SDK-owned.

## Alternatives considered

- Inferring identity from tool names or foreground state can show the wrong app.
- Putting icon data in text or screenshot content would expose presentation data to the model.
- Assigning message-scoped metadata to multiple results would falsely identify their targets.

## Consequences

The UI remains unchanged for tools without valid app metadata. The macOS producer must include the new metadata; no bundled runtime upgrade, database migration or Windows/Linux producer support is introduced here. Existing stored results without metadata cannot acquire an icon retrospectively.

## Verification

- AC1 — shared-schema and renderer tests cover valid targets, malformed or oversized payloads, target switching and fallback behavior.
- AC2 — Claude projection tests cover live and archived metadata ownership and reject ambiguous result batches; desktop tests preserve screenshot content.
- AC3 — native Pi SDK, MCP transport and QuickJS tests verify the app icon reaches presentation without entering code-mode results or model context.
- Electron and packaged-runtime visual verification remain pending.
