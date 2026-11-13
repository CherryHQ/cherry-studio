# Agent Note: Multi-instance Codex OAuth providers

Status: proposed

English | [中文](2026-11-13-multi-instance-codex-oauth-providers.zh.md)

## Problem

A single Codex provider session cannot distinguish multiple ChatGPT accounts. Users need separate provider instances to use accounts concurrently and identify their models.

## Proposal

Keep OAuth credentials and account identity per provider instance using existing storage. Route requests and session invalidation to the owning instance. Exclude concurrent browser sign-ins at the preset level because the OAuth redirect uses a fixed callback port. Show the account id alongside the provider name in selector groups, pinned rows and detail cards when available.

## Alternatives considered

- Store credentials for multiple accounts inside one provider row: rejected because maintainers deferred this approach and it needs its own selector and account-management contract.
- Run one loopback transport per instance: rejected because the fixed port 1455 redirect makes concurrent listeners collide, with no benefit over preset-scoped exclusion.

## Acceptance criteria

- AC1 — Two provider instances of the openai-codex preset each hold their own ChatGPT OAuth session; signing in the second never changes the first instance's tokens or account id. (verification: unit)
- AC2 — Both instances are usable in one app session without restarting: every request carries the bearer token and chatgpt-account-id of the instance it was sent through. (verification: unit)
- AC3 — Logging out, or losing one instance's session, clears and disables only that instance; the other instance's credentials and enablement are untouched. (verification: unit)
- AC4 — The model selector identifies which account a Codex model belongs to in provider groups, pinned rows and the detail card. (verification: renderer)
- AC5 — No database schema change or credential migration is required, and a single-instance installation keeps working unchanged. (verification: unit)

## Risks

The fixed callback port serialises browser sign-ins. Account ids are long in selector labels. A maintainer with two ChatGPT subscriptions is still required to prove upstream acceptance.
