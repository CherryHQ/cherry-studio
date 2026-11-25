# Agent Note: DeepSeek default time-based billing

Status: proposed

English | [中文](2026-11-14-deepseek-default-billing.zh.md)

## Problem

The official DeepSeek catalog stores peak prices. Without a saved provider schedule,
off-peak requests are estimated at peak prices. Daily schedules cannot distinguish
weekends. Retired Flash API aliases can inherit older prices.

## Proposal

Resolve official defaults at read time. Require the DeepSeek preset, its actual HTTPS
API host and a documented model ID. Preserve saved provider billing and stored model
price overrides. Apply one schedule-level Monday–Friday condition to the existing
multiplier mechanism. Preserve request-start snapshots and provider-reported cost priority.

Use Beijing time, peak multipliers of 1 at 09:00–12:00 and 14:00–18:00, and 0.5 otherwise.
Check only the day of week, including on public holidays, as requested. All years use
the same rule without a holiday table. Keep unknown-start peak fallback.
Reset restores inherited defaults. Unchanged Save does not persist a default snapshot.
The date preview shares the pricing resolver; custom model prices remain unchanged.

Official alias prices belong in provider overrides, not global creator prices.
Keep the catalog currency. Do not convert prices or reprice historical usage.

## Alternatives considered

- Always use peak prices: rejects the requested off-peak estimate.
- Seed default settings into every account: pins rules and confuses user overrides.
- Match model names only: incorrectly discounts third-party relays.
- Holiday tables and a recurring-calendar editor: exceed the requested weekday-only rule.
- Determine prices at completion: changes existing cross-boundary and history contracts.

## Acceptance criteria

- AC1 — Default requests select the correct Beijing-time boundary price; weekends remain off-peak and weekday holidays use normal weekday rates (verification: shared unit tests)
- AC2 — Current Flash, both retired Flash aliases and Pro use their respective official peak token rates (verification: registry tests)
- AC3 — Provider overrides, custom model prices and non-official endpoints retain their existing behavior (verification: shared and main integration tests)
- AC4 — Each invocation freezes its price; later requests resolve again; historical costs and reported costs are unchanged (verification: main integration tests)
- AC5 — Future years follow the same weekday rule; unknown start times retain an explicit peak fallback reason (verification: shared unit tests)
- AC6 — New and existing unconfigured accounts inherit defaults; unchanged Save and Reset preserve inheritance (verification: renderer and main integration tests)
- AC7 — Calendar settings survive persistence and can be removed using merge patch (verification: renderer and database tests)
- AC8 — Date preview and runtime capture agree; asynchronously loaded models receive defaults (verification: renderer and shared tests)

## Risks

The requested weekday-only estimate does not apply the provider's holiday exceptions.
DeepSeek does not specify the settlement instant for requests crossing a boundary.
Actual provider bills remain authoritative. Direct external runtimes without reliable invocation starts keep the
existing peak fallback. Desktop appearance and packaged-app behavior need separate
runtime evidence; unit and service tests do not establish those claims.

Source: [DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).
