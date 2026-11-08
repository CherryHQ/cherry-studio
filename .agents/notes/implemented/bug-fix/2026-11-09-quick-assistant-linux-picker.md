# Agent Note: Linux quick assistant picker geometry

Status: implemented

English | [中文](2026-11-09-quick-assistant-linux-picker.zh.md)

## Problem

Opening a picker expanded the Linux quick assistant from composer height to overlay height. Native movement and renderer layout could land in different frames, briefly moving the composer away from its screen position.

## Decision

Linux retains at least 560 pixels of window height for overlays. In bar view, Electron `setShape` limits drawing and input to the bottom composer rectangle; overlays and conversation panels restore the rectangular shape. Resize events refresh the shape. macOS and Windows retain their existing hover-forwarding behavior.

## Alternatives considered

Disabling resize animation still requires a native geometry change. Transparent headroom alone intercepts clicks behind the window; Linux cannot use the existing hover-forwarding mechanism.

## Consequences

Picker transitions at the normal overlay height no longer resize or move the window. Linux depends on Electron's experimental shape API; compositor-specific drawing and click-through behavior still require interactive acceptance. Heights above the reserved area can still require resizing.

## Verification

- Regression — `pnpm exec vitest run --project main src/main/services/__tests__/QuickAssistantService.test.ts`: 18 tests pass, including stationary picker transitions and collapsed input-region restoration.
- Regression — Minimal Electron 45.2.2 probes under X11 and Wayland complete shape transitions without errors; X11 bounds remain unchanged. These probes do not establish full-application visual or click-through acceptance.
