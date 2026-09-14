---
title: Primary chat endpoints share one API address field and preview
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-09-14
---

## What changed

Provider settings now show the primary chat endpoint preview below the API address field. Anthropic uses this same field, preview, validation, and reset action instead of a separate Anthropic address field.

## Why this matters to the user

The preview updates while editing the address. Changes apply only to the provider's primary chat endpoint; other configured endpoints remain intact. Clearing an Anthropic primary address restores the saved value on blur instead of removing its endpoint.

## What the user should do

Nothing — automatic. Existing provider addresses remain unchanged. Use Add Endpoint to manage other endpoints.

## Notes for release manager

Regression tests cover editing the Anthropic primary address through the shared field, preserving other endpoints and custom headers, and preventing an empty edit from deleting the primary endpoint.
