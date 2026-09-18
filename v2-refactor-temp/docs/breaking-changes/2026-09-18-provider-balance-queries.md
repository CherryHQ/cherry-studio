---
title: Query provider balances from connection settings
category: other
severity: notice
introduced_in_pr: TBD
date: 2026-09-18
---

## What changed

DeepSeek, SiliconFlow and Moonshot connection settings now show account balances with manual refresh and the last successful update time. Custom providers can configure a balance API URL, balance field path, currency and optional top-up URL, and test the query before saving.

## Why this matters to the user

Users can select which enabled API key to query. Failed refreshes retain the last successful balance; changing credentials or query settings invalidates it.

## What the user should do

Open the provider's connection settings. For a custom provider, configure the balance query and verify it with Test query before enabling it. The selected API key is sent to the configured query URL.
