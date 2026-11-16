# Agent Note: Product funnel analytics

Status: proposed

English | [中文](2026-11-16-product-funnel-analytics.zh.md)

## Problem

Operations needs to see where new users stop between first launch and their first successful Agent task, and how many users who sign in to CherryIN from the client go on to top up. The client reports only app launch, active days, and token usage to the existing analytics backend, plus subscription insights to PostHog. Onboarding, Agent sessions and turns, and CherryIN sign-in and top-up report nothing, so neither funnel can be built.

## Proposal

Add a product event catalog in `src/shared/ipc/schemas/analytics.ts`. Renderer events are a strict discriminated union validated by one IpcApi route, `analytics.track`; main-process events are typed only. Fields are enums, numbers, booleans, or random flow ids. They never carry user text, names, paths, URLs, or amounts.

`AnalyticsService.trackProductEvent` sends catalogued events from both editions to the Cherry Studio PostHog project; subscription insights stay in their edition's project. It reuses the existing consent gate, disabled GeoIP, and pinned `$ip`, maps fields to snake_case, and adds `schema_version`.

Events use the device's client id until a Cherry AI account is signed in. `CherryCloudService` then publishes the account's distinct id, `cloud-api:<edition>:<environment>:account:<id>`, the scheme subscription insights already use. Product events switch to that id with a person profile, and one `$identify` merges the device's earlier events into the account. Signing out returns later events to the client id. Nothing is sent, including the account merge, unless data collection is on and the current privacy policy is accepted. An event raised after consent but before the clients start is held in a bounded buffer and sent once they do. Revoking consent clears the buffer.

Events:

- New users: `app_opened` (onboarding status, once per process), `onboarding_option_selected`, `onboarding_step_viewed`, `onboarding_completed` (status, path, duration).
- Agent: `agent_session_created` (user-facing conversation sessions), `agent_turn_finished` (status, user or headless trigger, Agent kind, model source, duration, tool calls; once per turn), `agent_created` (manual or Cherry Assistant tool; built-in seeding excluded).
- CherryIN: `cherryin_entry_view`, `cherryin_sign_in_result` (onboarding or provider settings), `cherryin_topup_clicked` (with a flow id that is also passed to the top-up page as `entry`, `entry_source`, and `flow_id`), `cherryin_balance_increased` (same flow id, no amount), `cherryin_quota_error` (chat or agent).

Model source is `cherry_free`, `cherry_cloud`, `cherryin`, or `own_key`. Subscription insights keep their existing contract and identity. App launch, active days, and token usage stay on the existing analytics backend.

## Alternatives considered

- Self-hosted receiver, ClickHouse, and Metabase: duplicates the PostHog pipeline the client already ships and has no backend owner.
- A generic renderer `track(name, data)` route: lets arbitrary or identifying data through; an allow-list keeps the contract reviewable.
- `posthog-js` with autocapture in the renderer: records clicks and page content outside the catalog and bypasses the main-process consent owner.
- Keep every event anonymous: funnels could not be joined per person with subscriptions or free-model access, which are tied to the Cherry AI account.
- Bind the CherryIN account instead: CherryIN is today's onboarding login, but the Cherry AI account is the product identity, and PostHog cannot merge two identified accounts into one person. Top-up clicks join CherryIN orders through the flow id.

## Acceptance criteria

- AC1 — With consent, a catalogued event from either edition reaches the Cherry Studio PostHog project with snake_case fields and `schema_version`; without consent nothing is sent or later replayed, and an event raised between consent and client start-up is delivered once. (verification: unit; owner: analytics)
- AC2 — `analytics.track` rejects uncatalogued events, extra fields, and free-form values such as URLs in id fields. (verification: unit; owner: analytics)
- AC3 — Onboarding reports the selected option, each provider or model step entered, and completion with status, path, and duration; completion is reported only after the status is saved. (verification: renderer; owner: onboarding)
- AC4 — Each process reports `app_opened` once with its onboarding status; user-facing Agent sessions report creation; each Agent turn reports one terminal event with status, trigger, Agent kind, and model source; user-created Agents report creation while built-in seeding does not. (verification: unit; owner: agent runtime)
- AC5 — CherryIN sign-in from onboarding and provider settings reports its result; the settings card reports one entry view per window; a top-up click reports a flow id and opens the top-up page with that flow id and entry source; a later balance increase reports the same flow id without an amount; insufficient-balance failures on CherryIN report the composer. (verification: renderer and unit; owner: CherryIN)
- AC6 — While a Cherry AI account is signed in, product events carry its account distinct id and the device's earlier events are merged into it once; after sign-out they return to the client id. (verification: unit; owner: analytics and Cherry Cloud)

## Risks

- The current privacy policy (2026-08-20) describes highly aggregated anonymous data. These events contain no content, but signed-in events are tied to an account, so legal must confirm they fit the policy before release.
- Only users who accepted the privacy policy are counted, so absolute numbers are low; dashboards rely on ratios and trends.
- First top-up and amounts are authoritative only in CherryIN orders; the client balance increase is an observation, not revenue.
