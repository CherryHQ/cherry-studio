# Agent Note: Product usage analytics

Status: proposed

English | [中文](2026-11-16-product-usage-analytics.zh.md)

## Problem

Product funnel analytics (`2026-11-16-product-funnel-analytics.md`) shows whether new users reach a first Agent task and whether CherryIN users top up. It cannot show which features are used, how long people stay on each page, which controls are never clicked, which value each setting is left at, or how people use conversation branches and message actions. Development builds also send product events that look exactly like release traffic.

## Proposal

Extend the product event catalog in `src/shared/ipc/schemas/analytics.ts` and keep its rules: consent-gated, static identifiers only, no content.

- Feature results: `chat_turn_finished` (status, model source, duration, web search and knowledge use, MCP tool count, attachment count) and `feature_used` for 15 features (feature, action, optional status, model source, trigger, preset `target`, count, duration).
- Page dwell: `page_viewed` is reported when a segment ends, with the page from a fixed list (selection windows report `selection`), an optional settings section or built-in mini app id, wall time, active time, and end reason. Active time counts only while the window is focused, the page is visible, and there was input in the last 60 seconds. Background tabs do not count; 30 idle minutes end a segment; segments are capped at 4 hours and segments under 1 second are dropped.
- Clicks: `ui_clicked` covers every click on an interactive control. It reports the control's analytics name, else the nearest static `data-ui` token (or `unlabeled`), plus the page, the element kind, and pointer or keyboard; it never reads text, values, links, or coordinates.
- Analytics control names: the renderer build adds a `data-analytics` attribute to each interactive element, separate from the `data-ui` contract. The name is derived only from source: the owning component plus the control's label i18n key or its named handler, never display text or runtime values.
- Commands: `command_executed` reports the static command id and whether a shortcut, menu, or palette ran it.
- Settings: `setting_changed` reports the preference key of a user write, with the value only when it is a boolean, a number, or one of the setting's fixed options. Once per local day, `settings_snapshot` reports the current value of every catalogued setting the same way; free-text settings report only whether they differ from the default, and the user avatar reports only its kind (default, emoji, or image). A generated catalog, built from the preference schema types, lists each key's kind and fixed options.
- Conversation branches: `chat_branch_used` reports branch creation with its source (regenerate, edit and resend, manual, @-mentioned model), switching, deletion, and opening the branch panel. Once per local day, `chat_branch_snapshot` reports the number of topics, of topics with more than one branch, and of branches in them.
- Message actions: `message_action_used` reports the static id of a message toolbar or menu action that actually ran.
- Every product event carries `test`, true for development builds and builds pointed at another PostHog project or Cloud backend, and the device's local hour and weekday, so activity can be read in users' local time without a time zone name or location.

Page dwell, clicks, commands, settings, snapshots, branches, and message actions are usage behavior that goes beyond the current privacy policy's wording. Main drops them unless the build sets `MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS=true`, which waits on the privacy review.

## Alternatives considered

- `posthog-js` autocapture: records element text and page URLs and bypasses the main-process consent gate.
- Hand-written events per button: misses most controls and needs code for every new one; the build-time `data-ui` tokens already name every component.
- Report dwell on enter and leave: doubles the event count without adding information.
- Report setting values for text settings: they can hold hosts, paths, or keys.
- Name every control by extending `data-ui`: `data-ui` is a styling and E2E contract with stability tiers; per-control names would enlarge it and tie analytics renames to that contract.
- Infer the setting snapshot from `setting_changed`: it never sees settings left at their default or changed before analytics consent.
- Infer branch use from clicks: clicks cannot tell regenerate from edit and resend, and miss branches created from the branch panel.

## Acceptance criteria

- AC1 — Feature results report one event per completed chat reply or feature action with its status, and Agent turns do not report `chat_turn_finished`; `target` is only ever a preset id. (verification: unit and renderer; owner: analytics call sites)
- AC2 — Page dwell reports one segment per page visit with active time limited to focused, visible, recently used time; background tabs, sub-second visits, idle time, and route parameters never enter the event. (verification: renderer; owner: renderer shell)
- AC3 — Every click on an interactive control reports its analytics name, else the nearest static token, with page, element kind, and input type, de-duplicated within 500 ms, without reading text or content; the build names controls from source alone. (verification: unit and renderer; owner: renderer shell and UI contract build)
- AC4 — Commands report only when a handler runs; setting changes report user writes only, with values for booleans, numbers, and catalogued fixed options alone, coalesced per key within 2 seconds. (verification: unit and renderer; owner: commands and preferences)
- AC5 — Product events carry `test` and the local hour and weekday, and usage-behavior events are dropped unless the build enables them. (verification: unit; owner: analytics)
- AC6 — At most one settings snapshot per local day reports catalogued values, with free-text settings reduced to set or not set and the avatar to its kind; the catalog matches the preference schema. (verification: unit; owner: analytics)
- AC7 — Branch creation reports its source, switching, deletion, and panel opening each report once, and a daily snapshot reports topic, branched-topic, and branch counts. (verification: unit and renderer; owner: chat)
- AC8 — A message action reports its static id only when it ran, including translation and @-mention picks. (verification: renderer; owner: chat)

## Risks

- Behavior events need legal confirmation before the switch is turned on.
- Dwell and click volume is tens of events per user per day; PostHog charges by volume above its free tier, so sampling may be needed.
- Inferred `data-ui` tokens and analytics names change when components, handlers, or label keys are renamed; long-lived analysis should rely on explicit names.
- The settings snapshot adds about 200 properties per user per day; the catalog must stay generated so new free-text settings never report values.
