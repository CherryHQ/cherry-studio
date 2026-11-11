# Agent Note: Preserve newer settings search input during URL mirroring

Status: implemented

English | [中文](2026-11-08-settings-search-url-mirror.zh.md)

## Problem

Settings search mirrors its input into the URL after a debounce. If the user typed more characters while an earlier navigation was pending, that navigation could arrive with an older query and overwrite both the input and live results. Hosted smoke traces recorded `proxy` reverting to `prox` or `pr` without further input.

## Decision

Mark each URL mirror in router history state with its component owner and revision. Its first acknowledgement updates the observed URL without replacing newer input. Revisiting an acknowledged history entry remains an external navigation and restores its query. Apply the same ownership rule to debounced typing, Enter and clearing.

## Alternatives considered

- Slower E2E typing would hide a race available to real users.
- Comparing query strings cannot distinguish an older mirror from an external navigation.
- Ignoring every URL update during editing would break history and deep-link synchronization.

## Consequences

Typing and live results remain current while their URL mirror catches up. History and deep links continue to restore their query. The marker stays in local router history state; it adds no URL parameter or persisted preference.

## Verification

- Regression — the delayed-navigation test failed with `prox` instead of `proxy` before the repair. It now preserves the input, live query and next URL mirror.
- Regression — 36 renderer checks pass across SettingsSearchBox, SettingsSearchDomIds and SettingsPage, including external query updates and revisiting an acknowledged mirror. Hosted smoke acceptance remains subject to the complete workflow rerun.
