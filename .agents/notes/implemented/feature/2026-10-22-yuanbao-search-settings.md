# Agent Note: Yuanbao search settings and count compatibility

Status: implemented

English | [中文](2026-10-22-yuanbao-search-settings.zh.md)

## Problem

Sending only `Query` leaves the existing result-count preference unable to request more upstream results. Local blacklist filtering also consumes returned slots. Tencent supports `Cnt` in steps of ten up to fifty and `Site` exclusions for at most five domains, but its lite tier does not support `Cnt`.

## Decision

The portable Yuanbao protocol rounds the requested count up to the next supported value, capped at fifty, and still truncates the response to the local limit. It normalizes and deduplicates domain exclusions, sends at most five valid domains, and omits empty `Site` values.

Desktop converts only whole-domain rules of the form `*://*.example.com/*` into upstream exclusions. Exact-host, scheme-specific, path-specific, regular-expression, and remaining rules stay enforced by the existing local filter; converting them into domain-wide exclusions could remove allowed results.

Desktop retries once without `Cnt` only for a provider `InvalidParameter` error whose message explicitly says that `Cnt` is unsupported. The retry keeps the same credentials, query, endpoint, cancellation signal, and `Site`. Other errors propagate. A second failure propagates without another retry. Later searches try `Cnt` again; no account-tier cache or setting is introduced. The protocol exposes `useDefaultResultCount` for this host policy and remains single-request.

## Alternatives considered

- Always omitting `Cnt` keeps lite compatibility but does not connect the result-count preference to the upstream service.
- Adding a tier selector duplicates account configuration and requires the user to keep it current.
- Retrying every parameter error can hide invalid queries or unrelated configuration errors.
- Extracting domains from arbitrary blacklist patterns broadens exclusions beyond the user's rule.

## Consequences

An explicitly unsupported count can cost a second request on each search. Error-message matching accepts explicit English and Chinese forms; unfamiliar wording fails visibly instead of triggering a speculative retry. Non-2xx errors remain HTTP failures and do not trigger this provider-error fallback. Limits above fifty cannot force more than fifty upstream results, and local filtering can reduce the returned count further. Only Site exclusion is connected; positive site selection, Mode, and Deeplinks are outside this change.

## Verification

- Regression — `packages/web-search/src/__tests__/protocols.test.ts`: supported count boundaries, local truncation, domain validation/deduplication/limit, empty Site omission, and explicit count omission.
- Regression — `src/main/services/webSearch/providers/__tests__/ApiProviders.test.ts`: safe blacklist conversion, same-key retry with Site preservation, next-call key rotation, unrelated-error rejection, bounded failure, and cancellation.
