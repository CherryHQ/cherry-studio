---
title: Agent browser tools continue when the browser pane is hidden
category: changed
severity: notice
introduced_in_pr: '#20166'
date: '2026-09-11'
---

## What changed

Closing the right pane or switching to another app page preserves the Agent session's browser. Browser tools can continue using the same page while its presentation is hidden.

## Why this matters to the user

Opening Settings no longer detaches the Agent browser or makes its tools wait for the pane to reopen. Closing the owning app tabs, deleting the session or closing its host window releases the browser.

## What the user should do

Nothing — automatic.
