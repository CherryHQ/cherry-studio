---
title: V1.9.13 can upgrade directly to any V2.0.x release
category: data-migration
severity: notice
introduced_in_pr: TBD
date: 2026-08-07
---

## What changed

Every Cherry Studio v2.0.x patch is now accepted as a first v2 migration target
for users upgrading from v1.9.13. Starting with v2.1.0, later releases still
require users to pass through the v2.0.x migration line first.

## Why this matters to the user

V2.0.x patches retain the complete v1-to-v2 migration and can include fixes for
migration crashes, memory pressure, Agent data paths, and legacy provider
credentials. Users can install the latest v2.0.x patch directly instead of
installing v2.0.0 first.

## What the user should do

Nothing — automatic once the managed release service targets v2.0.1 for v1.9.13
clients.

## Notes for release manager

The managed release service gateway must be updated separately. At authoring
time, production still routes v1.9.13 clients to v2.0.0.
