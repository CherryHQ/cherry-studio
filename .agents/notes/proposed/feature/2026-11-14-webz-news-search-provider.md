# Agent Note: Webz.io News Search web-search provider

Status: proposed

English | [中文](2026-11-14-webz-news-search-provider.zh.md)

## Problem

Cherry Studio's web-search providers are general web indexes. Current-events research, media monitoring, and news-grounded answers need recent news articles with publication dates and source metadata. Issue CherryHQ/cherry-studio#20821 requests a Webz.io News Search provider. Webz.io documents a News Search API that returns articles from the last 30 days, ranked by meaning and paired with a relevant excerpt.

## Proposal

Add a `webz` remote web-search provider, named "Webz.io News", with the `searchKeywords` capability only. It follows the existing Tavily pattern: an API key stored in web-search settings, a `WebSearchProviderModule` in `packages/web-search/src/providers/`, and registration in the shared catalog and provider ID list.

Each search sends a JSON `POST` to the documented endpoint `http://api.webz.io/api/news/context` with `Authorization: Bearer <apiKey>`. The request body carries `query` set to the user's input and `k` set to the requested result count, capped at 50. No other request parameters are sent: no filters, `score_gte`, or `allow_multiple_chunks_per_article`. Each returned item maps to a standard search result: `article.title` to `title`, `article.url` to `url`, `chunk.text` to `content`, and the input to `sourceInput`. Items without a URL are dropped. The provider returns only what the API returns and does not add a date or source field to `WebSearchResult`.

The result-count cap is deliberately conservative. The [parameter reference](https://docs.webz.io/docs/webz/news-search-api-parameters) (updated August 30, 2026) documents a maximum `k` of 100, while the [errors reference](https://docs.webz.io/docs/webz/news-search-api-errors-limits) (updated August 19, 2026) says `k > 50` produces HTTP 422. Both pages were checked on November 14, 2026; no authenticated request verified support for 51-100 results. This Spec therefore caps `k` at 50, the lower documented value. Raising the cap requires resolving that upstream contract conflict first.

The endpoint is documented as plain HTTP. Implementation must confirm whether the same endpoint accepts HTTPS before choosing the default host. If only HTTP is available, the provider ships with that default and the bearer token travels unencrypted; that consequence is accepted only with explicit approval of this Spec.

Out of scope: filters (country, language, category, sentiment, date), relevance thresholds, full-article retrieval through the News API, and any fetch-URL capability.

## Alternatives considered

- A general-purpose search provider already exists, but it does not return news-specific metadata or recent-news coverage guarantees.
- Exposing filters now adds configuration surface and a settings UI the requester did not ask for; they can be added later as a separate Spec.
- A custom MCP server works, but the user would have to configure it outside Cherry Studio instead of using the same provider-selection flow as Tavily and Exa.
- Adding a full-article fetch through the News API doubles credit use for each search and adds a second upstream contract.

## Acceptance criteria

- AC1 — The `webz` provider ID, metadata, and `searchKeywords` capability are registered in the shared catalog and provider list, and the web-search settings expose it with an API key input (verification: unit)
- AC2 — A keyword search sends one authenticated POST with `query` and `k`, and maps returned articles to title, URL, excerpt, and source input, dropping items with no URL (verification: unit)
- AC3 — Requested result counts above 50 are capped at 50, and a non-success response or unexpected body surfaces as a provider error (verification: unit)
- AC4 — Provider icon, display name, and localized labels are present in the renderer and generated consumers stay consistent (verification: renderer)
- AC5 — Documentation for the provider, including the HTTP endpoint and the 30-day coverage window, is updated in English and Chinese (verification: docs gate)

## Risks

The documented endpoint is plain HTTP, so a bearer token could be exposed in transit unless HTTPS is confirmed. The 30-day coverage window means searches for older news return nothing, which the provider cannot detect and should not fake. Each search consumes credits, so the result-count default should stay conservative. Webz.io's documentation may change; the endpoint and response fields must be rechecked at implementation time.
