---
title: Streaming API startup failures now return HTTP errors
category: changed
severity: notice
introduced_in_pr: "#17097"
date: 2026-07-16
---

## What changed

Local API Gateway streaming requests now return the provider's HTTP error status when a failure occurs before any model output is produced. Previously these startup failures returned HTTP 200 and reported the failure only through an SSE error frame; failures after streaming output begins still use SSE error frames.

## Why this matters to the user

API clients can now distinguish non-retryable request errors such as context-length overflow from retryable provider outages before a stream starts. Clients that assumed every streaming request begins with HTTP 200 may observe HTTP 4xx, 5xx, or 504 responses for startup failures.

## What the user should do

Nothing — automatic. Custom API clients should handle ordinary HTTP error responses as well as terminal SSE error events.

## Notes for release manager

This change depends on #17091 preserving provider status metadata through the AI SDK stream boundary.
