# Agent Note: Unify production analytics in PostHog project 698240

Status: proposed

English | [中文](2026-11-24-unify-posthog-production.zh.md)

## Problem

China desktop subscription and Go backend events already reach project 698240. Global desktop subscription events reach project 149564. The global backend route is unverified. Project-scoped queries prevent a single funnel across these streams, and the global desktop currently falls back to an installation ID for subscription events.

## Proposal

Use 698240 as the production destination for product analytics from both desktop editions and their corresponding backend services. Its display name is `Cherry Studio`. Keep `region`, `environment`, and `producer` available to filter dashboards. Keep desktop consent and the development test-project override. This change covers PostHog product events.

Keep subscription UI steps on the desktop and authoritative payment and entitlement results on the backend. For authenticated steps, agree on an account identity shared by each desktop edition and its backend. Deduplicate across editions only where a trusted shared identity exists. Use flow identifiers for applicable pre-login attribution.

Review project access and reproduce required reports in 698240 before cutover. Project 149564 is named `Cherry Studio (Legacy)`. Keep its history and existing dashboards accessible. Older desktop releases can continue to send events there during the rollout.

## Alternatives considered

Keep regional projects and use a cross-project dashboard or warehouse reporting. That preserves project-level separation and requires a separate aggregation path for unified user journeys.

## Acceptance criteria

- AC1 — With no override, both production desktop editions select the project 698240 token and preserve edition properties. Development without a test token sends no PostHog product events (verification: desktop maintainers, focused unit tests and packaged artifacts)
- AC2 — Each region's desktop and backend subscription events arrive in 698240 and a test transaction can be traced through subscription, payment, entitlement activation, and desktop refresh with one count per authoritative outcome (verification: service and analytics owners, end-to-end test transaction)
- AC3 — Required production reports are accessible in 698240 and historical reports are accessible in 149564 after the routing cutover (verification: analytics owner, PostHog dashboard and settings inspection)

## Risks

The projects currently hold different history, and released desktop versions retain their bundled routing. Record the cutover date for reporting. Verify the global backend destination and identity contract before deployment. A desktop rollback can restore the prior routing with a release using the previous configuration.
