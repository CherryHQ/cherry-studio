# Agent Note: Keep PlantUML responses scoped to the current preview

Status: implemented

English | [中文](2026-11-27-plantuml-preview-stale-response.zh.md)

## Problem

PlantUML asynchronously fetches an SVG. An old response can finish after the input is replaced or cleared and mount obsolete output in the preview.

## Decision

The preview captures the identity of its input before fetching. It checks that identity immediately before mounting the SVG and retires it when the input changes or unmounts.

## Alternatives considered

- Waiting on each fetch in order would let a slow older render hold up the current preview.

## Consequences

A current valid diagram still renders through the existing SVG path. The network request contract stays the same.

## Verification

- Regression — `src/renderer/components/Preview/__tests__/PlantUmlPreview.test.tsx`: delayed responses cannot overwrite the latest diagram or populate a cleared preview.
