# Agent Note: Reject obsolete Mermaid preview output

Status: implemented

English | [中文](2026-11-27-mermaid-preview-stale-svg.zh.md)

## Problem

A Mermaid worker response can arrive after the preview source or rendering options change. It could mount a diagram for an obsolete input before the replacement renders.

## Decision

The Mermaid preview retires old render requests when its inputs change or its host unmounts. Only a current request can update the preview's SVG.

## Alternatives considered

- The worker queue can coalesce waiting requests but cannot retract a render that has already been dispatched.

## Consequences

The replacement can render when ready. An obsolete response cannot update a reused or detached host.

## Verification

- Regression — `src/renderer/components/Preview/__tests__/MermaidPreview.test.tsx`: drives Worker responses across a source change and unmount.
