---
title: Model checks now report results in the model list
category: moved
severity: notice
introduced_in_pr: "#18581"
date: 2026-08-14
---

## What changed

Provider health and connectivity checks are now a single **Model Check** action. Its dialog can check
one model or all supported models; all-model results and errors appear beside each model instead of in
a separate results drawer.

## Why this matters to the user

Users can keep browsing, searching, and filtering models while a full check runs, and can inspect the
result for each API key directly from a model row. Image, video, and audio generation models plus
speech-to-text and text-to-speech models are skipped to avoid unnecessary generation charges.

## What the user should do

Nothing — automatic. Use **Model Check** in Settings → Model Providers and select either a single
model or all models.

## Notes for release manager

Addresses issues #17935 and #18434. Failed API keys can be enabled or disabled from the result detail,
and failed models can be removed after the check finishes.
