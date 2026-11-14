# Agent Note: Web search blacklist subscriptions

Status: proposed

English | [中文](2026-11-12-web-search-blacklist-subscriptions.zh.md)

## Problem

v1 let users add uBlacklist-format subscription URLs to the web search blacklist. v2.0.2 keeps only the manual `chat.web_search.exclude_domains` textarea, so community lists such as `eallion/uBlacklist-subscription-compilation` can no longer be used. The official docs still describe subscriptions. v1 subscription entries (`websearch.subscribeSources`, `{ key, url, name, blacklist? }`) were not carried into v2; the v1 migration path also reset that field to `[]`, so recovery from old data may find little or nothing.

## Proposal

Restore subscription sources as an additional input to the existing blacklist. Manual rules stay as they are.

- Storage: a new preference `chat.web_search.blacklist_subscriptions`, a JSON array of `{ id, url, name?, rules: string[], updatedAt?, lastError? }`. No SQLite table. The cached `rules` are stored with the source so search keeps working offline.
- Parsing: subscription bodies use uBlacklist format. Trim each line, skip blank lines and comments (`#`, `!`), and keep only lines that `parseMatchPattern` or the regex parser accepts. Invalid lines are counted and dropped, not fatal.
- Effective blacklist: `WebSearchService` merges manual `exclude_domains` with the rules from every enabled subscription (deduplicated) before `filterWebSearchResponseWithBlacklist` and `toExcludedSiteDomains`. Manual rules are never removed by a refresh.
- Refresh: a manual per-source refresh button in the Blacklist settings, plus a periodic refresh every 24 hours in the main process via `registerInterval`. A failed refresh keeps the last successful rules and records `lastError`.
- Renderer: add-URL input with validation, list of sources showing name, rule count, last update, and error state, with refresh and remove actions. Built with `@cherrystudio/ui`.
- v1 migration: a dedicated migrator reads `websearch.subscribeSources` when present and writes the same preference. Fields missing from v1 are left empty; the migrator does not guess URLs.
- Out of scope: local-file import, subscription formats other than uBlacklist, and syncing across devices.

## Alternatives considered

- SQLite table through DataApi: gives relational history and cleaner refresh tracking, but the data is a small list of URLs and cached rules that always loads with settings. It adds schema, migration, and DataApi endpoints for little benefit.
- Manual refresh only: simpler and no background network activity, but subscriptions go stale unless users remember to refresh. Rejected by the user in favor of periodic refresh.
- Refresh on app start only: avoids a timer, but a long-running session would never update. Not chosen.
- Local-file bulk import: useful for offline lists, but it does not restore the v1 URL feature. Deferred; the user declined it for this change.
- Converting every subscription rule into provider `Site` exclusions: only whole-domain rules qualify (see the existing `toExcludedSiteDomains` contract). Other rules stay local, as today.

## Acceptance criteria

- AC1 — Adding a valid HTTP(S) subscription URL stores it, fetches it, and shows the parsed rule count (verification: renderer)
- AC2 — Invalid or non-HTTP(S) URLs are rejected in the UI and never stored (verification: renderer)
- AC3 — uBlacklist parsing ignores blank lines and `#`/`!` comments, keeps valid match patterns and regexes, and drops invalid lines without failing the whole list (verification: unit)
- AC4 — A search result whose URL matches only a subscription rule is removed, and a manual rule still applies after the subscription is removed (verification: unit)
- AC5 — The 24-hour periodic refresh and the manual refresh update the cached rules; a failed refresh keeps the previous rules and sets `lastError` (verification: unit)
- AC6 — Removing a subscription removes its rules from the effective blacklist without changing manual `exclude_domains` (verification: unit)
- AC7 — v1 `websearch.subscribeSources` entries with a `url` migrate to the new preference; entries without a URL are skipped (verification: unit)
- AC8 — Whole-domain subscription rules feed provider `Site` exclusion through `toExcludedSiteDomains`, unchanged for manual rules (verification: unit)
- AC9 — Existing manual blacklist behavior is unchanged when no subscription exists (verification: unit, renderer)
- AC10 — All new user-visible strings exist in `en-us.json` and every locale is synced via `pnpm i18n:sync` with no placeholders left (verification: docs gate)

## Risks

- A periodic fetch adds outbound network traffic; it must respect the app's proxy settings and use a bounded timeout.
- A large or malicious list could slow filtering; the implementation should cap the number of rules per source.
- The v1 data may be empty after earlier migrations, so AC7 may migrate nothing for many users. The docs must state that subscriptions must be re-added.
- The preference schema is generated from `data/classification.json`; the change must go through `scripts/data-classify` and must not hand-edit generated files.
