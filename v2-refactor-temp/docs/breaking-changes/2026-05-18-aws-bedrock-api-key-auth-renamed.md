---
title: AWS Bedrock api-key auth carries its own region
category: data-migration
severity: notice
introduced_in_pr: #15088
date: 2026-05-18
---

## What changed

AWS Bedrock api-key authentication is now its own auth variant
(`api-key-aws`) with an explicit `region`, instead of reusing the
`api-key` shape. The v1→v2 migrator converts existing Bedrock api-key
rows automatically, carrying the region forward.

## Why this matters to the user

Normal users notice nothing — migration is automatic and the region is
preserved. The region field now stays visible on the Bedrock settings
panel regardless of the auth-mode toggle, and switching auth mode or
saving with an empty region is now blocked with a warning instead of
silently defaulting to `us-east-1`.

## What the user should do

Nothing for normal upgrades. Only users who manually constructed
`aws-bedrock` auth configs (e.g. via scripted import) need to use the
`api-key-aws` shape with an explicit `region`.

## Notes for release manager

Pair with `2026-05-18-anthropic-oauth-removed.md` (same PR). Empty
region is rejected on every renderer write path (auth-mode toggle, IAM
config save, region save). The `AuthConfigSchema` zod is intentionally
left permissive (`z.string()`): not for migration safety — the migrator
and preset seeder write `authConfig` as raw JSON through Drizzle and
never run zod — but because the duplicate-provider flow legitimately
creates an `aws-bedrock` row with `region: ''` as a "fill in after
create" placeholder, which goes through `CreateProviderSchema.parse`.
