# Agent Note: Main window defaults and screen bounds

Status: implemented

English | [中文](2026-11-14-main-window-bounds.zh.md)

## Problem

Main uses its 960 × 600 minimum as its initial size. Remembered bounds can shrink to a smaller screen, but the fixed native minimum and minimum-size reset can expand the window past that screen again.

## Decision

The main window starts at 90% of the primary work area, capped at 1440 × 900 DIPs and floored at 960 × 600 where the work area permits. Valid remembered geometry takes precedence. Both the initial rectangle and native size limits fit the work area, including displays with negative coordinates.

Screen fitting runs when constructing the window and on explicit minimum-size changes from compact mode. MainWindowService limits the requested minimum to the current work area and fits ordinary geometry when applying it. It updates the minimum without explicitly resizing maximized, fullscreen, or minimized windows. There is no screen-based maximum size or ongoing display/move correction, so users retain control of window size and placement after creation.

## Alternatives considered

- A larger fixed default can exceed a small screen.
- Raising the global minimum makes small-screen behavior worse and changes unrelated consumers.
- Discarding old geometry enlarges windows users deliberately resized.

## Consequences

Existing valid saved sizes are not automatically enlarged. Screens smaller than the normal minimum take priority over the layout floor. The 1440 × 900 cap applies only to the initial default, leaving manual resizing unrestricted. Display changes after creation are handled by the operating system rather than application-driven resizing.

## Verification

- Regression — `mainWindowBounds.test.ts`: initial sizes, work-area offsets, ultrawide and portrait screens, negative coordinates, removed displays, invalid records, and minimum expansion keep the resulting rectangle within the work area.
- Regression — `MainWindowService.test.ts`: explicit minimum changes fit both dimensions to small screens, minimum reset grows compact geometry within the work area, lowering the minimum preserves user geometry, and special window states receive minimum updates without explicit resizing.
- Prior macOS Electron 45.2.2 runtime verification covered initial 1440 × 900 bounds within a 1728 × 1024 work area and restart restoration to 1200 × 760. The removal of ongoing size limits and correction is covered by focused source and unit checks; interactive verification of this revision remains pending.
