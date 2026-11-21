---
description: How to set up Webz.io News Search?
icon: newspaper
---

# Webz.io News Search Configuration

[Webz.io](https://webz.io/)'s News Search API searches **news from the last 30 days** with a natural-language query, ranks articles by meaning, and returns the most relevant excerpt of each article. In Cherry Studio it is available as the **Webz.io News** search provider. It supports keyword search only and does not fetch URLs.

## 1. Get an API key

1. Open [https://app.webz.io](https://app.webz.io) and sign up with your email (a verification code) or a Google / Microsoft account.
2. Create or copy your News Search API key from the dashboard.

## 2. Configure Cherry Studio

1. Go to **Settings > Web Search**.
2. Select **Webz.io News** as the search provider.
3. Paste the API key and save.

Cherry Studio sends a single `POST https://api.webz.io/api/news/context` request per search (over HTTPS, so your key is encrypted in transit) carrying only the query text and the result count, capped at 50 results per search.

## 3. Notes

* **Only news from the last 30 days is covered**; older news simply returns no results.
* Every search consumes credits from your Webz.io account; higher result counts cost more.
* The provider returns news search results only; filtering by country, language, or date is not supported.

See the official documentation for details: [Webz.io News Search API](https://docs.webz.io/docs/webz/news-search-api).
