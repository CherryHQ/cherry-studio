# Agent Note: Product funnel analytics

Status: implemented

English | [中文](2026-11-16-product-funnel-analytics.zh.md)

## Problem

Operations needs to see where new users stop between first launch and their first successful Agent task, and how many users who sign in to CherryIN from the client go on to top up. The client reported only app launch, active days, and token usage to the existing analytics backend, plus subscription insights to PostHog. Onboarding, Agent sessions and turns, and CherryIN sign-in and top-up reported nothing, so neither funnel could be built.

## Decision

`src/shared/ipc/schemas/analytics.ts` is the product event catalog. Renderer events are a strict discriminated union validated by one IpcApi route, `analytics.track`; main-process events are typed only. Fields are enums, numbers, booleans, or random flow ids, never user text, names, paths, URLs, or amounts.

`AnalyticsService.trackProductEvent` sends catalogued events from both editions to the Cherry Studio PostHog project; subscription insights stay in their edition's project. Nothing is sent, including the account merge, unless data collection is on and the current privacy policy is accepted. The service reuses the existing consent gate, disabled GeoIP, and pinned `$ip`, maps fields to snake_case, and adds `schema_version`. An event raised after consent but before the clients start waits in a buffer of at most 200 events and is sent once they do; revoking consent clears it.

Events use the device's client id until a Cherry AI account is signed in. `CherryCloudService` then publishes the account's distinct id, `cloud-api:<edition>:<environment>:account:<id>`, the scheme subscription insights already use. Product events switch to that id with a person profile, and one `$identify` per activation merges the device's earlier events into the account. Signing out returns later events to the client id.

Events:

- New users: `app_opened` (onboarding status, once per process, before replayed events), `onboarding_option_selected`, `onboarding_step_viewed`, `onboarding_completed` (status, path, duration; only after the status is saved).
- Agent: `agent_session_created` (DataApi creation, reuse-or-create when it creates, and the support, assistant, and skill sessions; not seeded, scheduled, channel, or forked sessions), `agent_turn_finished` (status, user or headless trigger, Agent kind, model source, duration, tool calls; once per turn from the runtime's terminal transition), `agent_created` (manual or Cherry Assistant tool; built-in seeding excluded).
- CherryIN: `cherryin_entry_view` (once per window), `cherryin_sign_in_result` (onboarding or provider settings; cancellation comes from the OAuth runtime's cancel code), `cherryin_topup_clicked` (with a flow id also passed to the top-up page as `entry`, `entry_source`, and `flow_id`), `cherryin_balance_increased` (same flow id, no amount), `cherryin_quota_error` (chat or agent, from the shared execution-failure classification).

Model source is `cherry_free`, `cherry_cloud`, `cherryin`, or `own_key`. App launch, active days, and token usage stay on the existing analytics backend.

## Alternatives considered

- Self-hosted receiver, ClickHouse, and Metabase: duplicates the PostHog pipeline the client already ships and has no backend owner.
- A generic renderer `track(name, data)` route: lets arbitrary or identifying data through; an allow-list keeps the contract reviewable.
- `posthog-js` with autocapture in the renderer: records clicks and page content outside the catalog and bypasses the main-process consent owner.
- Keep every event anonymous: funnels could not be joined per person with subscriptions or free-model access, which are tied to the Cherry AI account.
- Bind the CherryIN account instead: CherryIN is today's onboarding login, but the Cherry AI account is the product identity, and PostHog cannot merge two identified accounts into one person. Top-up clicks join CherryIN orders through the flow id.

## Consequences

- Only users who accepted the privacy policy are counted, so absolute numbers are low; dashboards rely on ratios and trends.
- The current privacy policy (2026-08-20) describes highly aggregated anonymous data; signed-in events are tied to an account, so legal must confirm the fit before release.
- First top-up and amounts are authoritative only in CherryIN orders; the client balance increase is an observation, not revenue.
- `tool_call_count` reads the turn's delivered tool parts, so runtimes that do not deliver them report 0.
- CherryIN insufficient-balance failures are recognized only when the provider error is classified as quota (HTTP 402 or a quota or balance message).

## Verification

- AC1 — `pnpm exec vitest run --project main src/main/services/__tests__/AnalyticsService.test.ts`: catalogued events reach the Cherry Studio project from the China edition while subscription insights stay in the China project; events without consent, or raised after collection is turned off, are never sent or replayed; an event raised between consent and start-up is delivered once.
- AC2 — `pnpm exec vitest run src/shared/ipc/schemas/__tests__/analytics.test.ts`: the route rejects uncatalogued events, extra fields, and a URL in an id field.
- AC3 — `pnpm test:renderer src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx`: the custom-provider, CherryIN, and skip paths report option, steps, and completion in order; a failed status save reports no completion.
- AC4 — `pnpm exec vitest run --project main src/main/services/__tests__/AnalyticsService.test.ts src/main/ai/agentSession/__tests__ src/main/ai/agents/__tests__ src/main/ai/mcp/servers/__tests__/assistant.test.ts src/main/ipc/handlers/__tests__/ai.test.ts src/main/data/api/handlers/__tests__/agentSessions.test.ts`: `app_opened` reports once before replayed events; a turn closed twice reports once; headless turns, CherryIN models, and built-in Agents are classified; only real creations report sessions and Agents.
- AC5 — `pnpm test:renderer src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/CherryInOauth.test.tsx src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx` and `pnpm exec vitest run --project main src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`: the entry view reports once, the top-up URL carries the flow id and source, a balance increase reports that flow id only when the balance rose, a stale onboarding attempt stays silent, and only CherryIN quota failures report.
- AC6 — `pnpm exec vitest run --project main src/main/services/__tests__/AnalyticsService.test.ts src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts`: a known account is identified before the launch event, later events carry its id with a person profile, sign-out returns to the client id, and Cherry Cloud publishes and releases the account.
