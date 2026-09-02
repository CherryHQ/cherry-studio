---
title: Provider availability now follows the app edition
category: changed
severity: breaking
introduced_in_pr: "#19776"
date: 2026-09-02
---

## What changed

The global and China editions share local user data, but each edition exposes only the providers and models it supports. Records unavailable in the current edition remain stored and become available again after switching back to a supporting edition.

## Why this matters to the user

After switching editions, assistants and agents bound to an unavailable provider or model cannot send requests until their model selection changes. No provider, model, assistant, or conversation data is deleted.

## What the user should do

Select a provider and model supported by the installed edition, or switch back to the edition that supports the existing configuration.

## Notes for release manager

Users who remain on the global edition are unaffected. Call out the required model reselection specifically for users switching to the China edition.
