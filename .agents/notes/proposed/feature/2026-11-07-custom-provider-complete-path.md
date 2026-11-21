# Agent Note: Preserve complete paths for custom providers

Status: proposed

English | [中文](2026-11-07-custom-provider-complete-path.zh.md)

## Problem

Custom providers can configure endpoint hosts, but request URL formatting may append a protocol path or normalize the configured URL. Gateways that expose a complete custom route can therefore receive a different path than the user entered, and the effective destination is not always clear before a request is sent.

## Proposal

Add an explicit complete-path option to each custom-provider endpoint configuration. When enabled, the configured endpoint URL supplies the request path; URL formatting must not append a default protocol path or infer another endpoint. When disabled, existing host formatting and endpoint-type path construction remain unchanged.

Show the effective request path in the custom-provider creation and request-configuration flows before saving or testing. Failure diagnostics should report the effective path while continuing to redact credentials and sensitive URL parameters. Protocol fallback and automatic endpoint detection are out of scope and require a separate reviewed decision.

The option is per endpoint, persists with that endpoint configuration, and defaults to the existing host-mode behavior. This Spec awaits an explicit human `APPROVED` review on its current PR head; implementation must not begin before approval.

## Alternatives considered

- Continue treating every configured URL as a host and append protocol paths. This preserves current behavior but cannot express arbitrary gateway routes.
- Automatically detect whether a path is complete from its suffix. This is ambiguous for custom routes and silently changes routing behavior.
- Add protocol fallback when the configured route fails. This can send requests to a different destination and is explicitly outside this decision.

## Acceptance criteria

- AC1 — Each custom-provider endpoint can explicitly select complete-path mode, and the choice survives saving and reloading without changing the default host-mode behavior (verification: implementation author; provider persistence tests)
- AC2 — In complete-path mode, requests use the configured endpoint path without appending a default protocol path or silently rewriting it; standard host mode retains existing endpoint-type path construction (verification: implementation author; focused provider configuration tests)
- AC3 — Provider creation and request configuration show the effective request path before saving or testing in either mode (verification: implementation author; renderer tests and Electron)
- AC4 — A failed request's diagnostics show its effective request path without exposing credentials or sensitive URL parameters (verification: implementation author; diagnostics tests and a credential-redaction check)
- AC5 — Selecting complete-path mode does not trigger protocol fallback or automatic endpoint detection (verification: implementation author; focused provider routing tests)

## Risks

Provider adapters may construct URLs differently. Verification must establish the actual outbound route, not only the configured base URL or a fetch-layer preview, and diagnostics must describe that same route without revealing secrets.
