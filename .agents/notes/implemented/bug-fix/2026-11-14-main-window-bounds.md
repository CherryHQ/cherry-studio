# Agent Note: Main window defaults and screen bounds

Status: implemented

English | [中文](2026-11-14-main-window-bounds.zh.md)

## Problem

Main uses its 960 × 600 minimum as its initial size. Remembered bounds can shrink to a smaller screen, but the fixed native minimum and minimum-size reset can expand the window past that screen again.

## Decision

The main window starts at 90% of the primary work area, capped at 1440 × 900 DIPs and floored at 960 × 600 where the work area permits. Valid remembered geometry takes precedence. Both the initial rectangle and native size limits fit the work area, including displays with negative coordinates.

MainWindowService retains the requested minimum separately from its screen-limited native value. Display changes and ordinary-window restoration reapply that minimum and the current work-area ceiling. This preserves compact mode across display changes. Screen listeners belong to the service lifecycle; window listeners attach on creation. Maximized, fullscreen, minimized, and destroyed windows are excluded from ordinary-geometry correction.

## Alternatives considered

- A larger fixed default can exceed a small screen.
- Raising the global minimum makes small-screen behavior worse and changes unrelated consumers.
- Discarding old geometry enlarges windows users deliberately resized.

## Consequences

Existing valid saved sizes are not automatically enlarged. Screens smaller than the normal minimum take priority over the layout floor. The default cap does not prevent manually enlarging the window to the work area. Completed-move checks use Electron's macOS/Windows `moved` event; Linux placement is controlled by its window manager.

## Verification

- Regression — `mainWindowBounds.test.ts`: initial sizes, work-area offsets, ultrawide and portrait screens, negative coordinates, removed displays, invalid records, and minimum expansion keep the resulting rectangle within the work area.
- Regression — `MainWindowService.test.ts`: minimum reset fits both dimensions, requested compact minimum survives display changes, screen events correct the live window, and fullscreen restoration fits ordinary geometry without changing special window states.
- Regression — macOS Electron 45.2.2 runtime: initial bounds are 1440 × 900 within a 1728 × 1024 work area; restart restores 1200 × 760; compact mode, minimum reset, off-screen correction, and fullscreen exit preserve usable ordinary bounds. Windows/Linux and physical display hotplug remain unverified.
