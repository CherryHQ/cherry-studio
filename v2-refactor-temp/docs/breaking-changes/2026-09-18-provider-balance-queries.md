---
title: Query provider balances from connection settings
category: other
severity: notice
introduced_in_pr: '#20738'
date: 2026-09-18
---

## What changed

DeepSeek, Moonshot, PPIO and Vercel AI Gateway connection settings now show account balances with manual refresh and the last successful update time. Custom providers can configure a balance API URL, balance field path, currency and optional top-up URL, and test the query before saving. SiliconFlow's retired account API is not supported.

## Why this matters to the user

Users can select which enabled API key to query. Failed refreshes retain the last successful balance; changing credentials or query settings invalidates it.

## What the user should do

Open the provider's connection settings. For a custom provider, configure the balance query and verify it with Test query before enabling it. The selected API key is sent to the configured query URL.

PPIO queries its official billing host (`api.ppio.com`), independently of the inference endpoint, and requires an API key with permission to read the account balance. For SiliconFlow, check the balance in its web console instead.
