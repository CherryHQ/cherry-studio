# Agent Note: Keep selector options inside the available viewport

Status: implemented

English | [中文](2026-11-07-selector-viewport.zh.md)

## Problem

MP-117 created and pruned real automatic backups, then could not choose Off. The selector opened upward with its first option above the window; scrolling could not bring it into view because the popup itself exceeded the available height.

## Decision

Constrain the existing ScrollArea by Radix Popover’s available-height variable, subtracting the content padding while preserving the existing 20rem cap.

## Alternatives considered

Forcing a click or enlarging the test window would hide an inaccessible product option. Custom popup positioning would duplicate the library.

## Consequences

Long menus scroll within the space above or below their trigger. Option values and selection behavior are unchanged.

## Verification

- Regression — The existing MP-117 real-Electron scenario reproduces the inaccessible Off option. Selector component tests pass; a post-fix Electron rerun is still required.
