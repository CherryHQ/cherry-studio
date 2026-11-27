# Agent Note: Synchronize hidden Work tab icons after Agent avatar changes

Status: implemented

English | [中文](2026-11-10-agent-tab-icon-sync.zh.md)

## Problem

Issue #23045 reports stale Work tab icons after editing an Agent avatar. React Activity pauses hidden pages' effects, including their data-change subscriptions and tab visual writers. Dormant tabs have no mounted page to refresh them. Updating only the tab icon also leaves the Agent query cache stale, allowing a resumed page to restore the old icon.

## Decision

Subscribe to Agent changes at the window runtime, outside tab pages. Resolve the sessions bound to Work tabs and read their current Agents, deduplicating Agent reads within each batch. Publish each complete Agent row to the existing query cache before updating matching tab icons. Keep titles and routes unchanged.

A later event supersedes the entire pending batch, so each batch refreshes every bound session. Check the lifecycle revision before cache publication and icon updates; recheck each tab's current session binding before writing. Isolate missing session or Agent failures so other tabs still refresh.

## Alternatives considered

- Page-only subscriptions cannot refresh hidden or dormant tabs.
- Updating icons without the existing Agent cache lets resumed pages overwrite them with stale data.
- Polling or changing the global query resume policy adds unrelated behavior.

## Consequences

Hidden and dormant Work tabs receive emoji, image and cleared-avatar changes without activation. Each Agent event adds reads for distinct bound sessions and their Agents. No new persistent mapping or cache is introduced.

## Verification

- Regression — real tab state, data-change subscriptions, query hooks and React Activity cover hidden-page recovery, dormant and pinned tabs, image and cleared avatars, unrelated tabs, missing rows, changed bindings, unmount and out-of-order reads.
- Regression — an older pending query cannot replace the published Agent row after the page resumes. The test keeps the query provider stable while running the application hooks under StrictMode.
- Regression — 26 tests passed across the new synchronization suite and existing title, page-visual and fullscreen suites; scoped lint and formatting passed.
- Limitation — Electron startup was blocked before launch because local Swift 6.0.3 does not satisfy the speech package's required Swift 6.2.0. Full application and real cross-window interaction were not verified.
