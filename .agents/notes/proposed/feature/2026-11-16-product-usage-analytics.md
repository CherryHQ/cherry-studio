# Agent Note: Product usage analytics

Status: proposed

English | [中文](2026-11-16-product-usage-analytics.zh.md)

## Problem

Product funnel analytics (`2026-11-16-product-funnel-analytics.md`) shows whether new users reach a first Agent task and whether CherryIN users top up. It cannot show which features are used, how long people stay on each page, or which controls are never clicked. Development builds also send product events that look exactly like release traffic.

## Proposal

Extend the product event catalog in `src/shared/ipc/schemas/analytics.ts` and keep its rules: consent-gated, static identifiers only, no content.

- Feature results: `chat_turn_finished` (status, model source, duration, web search and knowledge use, MCP tool count, attachment count) and `feature_used` for 15 features (feature, action, optional status, model source, trigger, preset `target`, count, duration).
- Page dwell: `page_viewed` is reported when a segment ends, with the page from a fixed list, an optional settings section or built-in mini app id, wall time, active time, and end reason. Active time counts only while the window is focused, the page is visible, and there was input in the last 60 seconds. Background tabs do not count; 30 idle minutes end a segment; segments are capped at 4 hours and segments under 1 second are dropped.
- Clicks: `ui_clicked` covers every click on an interactive control. It reports the nearest static `data-ui` token (or `unlabeled`), the page, the element kind, and pointer or keyboard; it never reads text, values, links, or coordinates.
- Commands: `command_executed` reports the static command id and whether a shortcut, menu, or palette ran it.
- Settings: `setting_changed` reports the preference key of a user write, with the value only when it is a boolean or number.
- Every product event carries `test`, true for development builds and builds pointed at another PostHog project or Cloud backend.

Page dwell, clicks, commands, and settings are usage behavior that goes beyond the current privacy policy's wording. Main drops them unless the build sets `MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS=true`, which waits on the privacy review.

## Alternatives considered

- `posthog-js` autocapture: records element text and page URLs and bypasses the main-process consent gate.
- Hand-written events per button: misses most controls and needs code for every new one; the build-time `data-ui` tokens already name every component.
- Report dwell on enter and leave: doubles the event count without adding information.
- Report setting values for text settings: they can hold hosts, paths, or keys.

## Acceptance criteria

- AC1 — Feature results report one event per completed chat reply or feature action with its status, and Agent turns do not report `chat_turn_finished`; `target` is only ever a preset id. (verification: unit and renderer; owner: analytics call sites)
- AC2 — Page dwell reports one segment per page visit with active time limited to focused, visible, recently used time; background tabs, sub-second visits, idle time, and route parameters never enter the event. (verification: renderer; owner: renderer shell)
- AC3 — Every click on an interactive control reports the nearest static token, page, element kind, and input type, de-duplicated within 500 ms, without reading text or content. (verification: renderer; owner: renderer shell)
- AC4 — Commands report only when a handler runs; setting changes report user writes only, with values for booleans and numbers alone, coalesced per key within 2 seconds. (verification: unit and renderer; owner: commands and preferences)
- AC5 — Product events carry `test`, and usage-behavior events are dropped unless the build enables them. (verification: unit; owner: analytics)

## Risks

- Behavior events need legal confirmation before the switch is turned on.
- Dwell and click volume is tens of events per user per day; PostHog charges by volume above its free tier, so sampling may be needed.
- Inferred `data-ui` tokens change when components are renamed; long-lived analysis should rely on explicit tokens.
