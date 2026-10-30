# Agent Note: Preserve Querit page failures and scope the fetch probe

Status: implemented

English | [中文](2026-10-27-querit-fetch-probe.zh.md)

## Problem

A Querit `/v1/contents` request can succeed while its per-URL crawl fails. Cherry discards the documented `statuses[]` outcome and reports explicit page failure as `invalid_response/empty_content`. Generic IPC normalization (`IpcError.from` → `INTERNAL`) then drops the provider classification before the settings toast. The settings check also uses the arbitrary third-party page `https://example.com` for every remote fetch provider.

## Decision

The contents protocol retains optional string `id`s on results and statuses, and optional top-level `statuses[]` entries with `id?` and `status: 'success' | 'failed'`, internally. Equal string ids associate a result with a status. For this single-input call, a sole status applies when results are absent or either id is absent; conflicting ids do not match. Multiple statuses without an attributable match leave existing trimmed-content validation in charge.

An attributable `failed` status wins over readable content and throws `provider / page_fetch_failed` through `protocolError`, with `Querit could not fetch page content for <trimmed input>`. Request-level `error_code` errors keep precedence. Only a typed Querit `fetchUrls` error with that kind and code is rethrown as the domain `IpcError` `WEB_SEARCH_PAGE_FETCH_FAILED` in `src/main/ipc/handlers/webSearch.ts`. Every other error propagates unchanged; the route keeps its `Promise<void>` success output.

The settings hook uses `https://www.querit.ai/en/docs/overview/about` only for Querit `fetchUrls` checks. Other remote fetch providers keep `https://example.com`; search keeps `Cherry Studio`. The domain error renders the existing failure title plus a new localized description naming the probe and stating that URL fetching was not verified.

## Alternatives considered

- Treating a failed page as success or a partial-connectivity warning changes the check's promise that success means usable fetched content.
- Matching statuses by array position or letting any failed status override can attribute another page's failure to the returned result.
- Requiring `statuses` breaks established status-less success; classifying every blank response as a page failure invents evidence where no attributable failure exists.
- Changing the generic IPC framework, public result type, or `WebSearchErrorKind` broadens shared contracts unnecessarily; the internal association, existing `provider` kind, and narrow domain mapping suffice.
- Making the probe configurable or storing it in shared preset/catalog metadata expands settings or shared APIs for a single desktop check policy owned by the hook.

## Consequences

Status-less success keeps working. Supplied malformed statuses, `null`, or numeric ids fail schema validation; optional means absent, not null. Ids stay internal. The documented sample page is a probe choice, not proof of live crawler reliability with Cherry's markdown/default-timeout request. Other providers and search checks are unchanged.

## Verification

- Regression — `packages/web-search/src/__tests__/protocols.test.ts`: page-failure matrix, id association, failure and request-error precedence, schema validation, and status-less compatibility.
- Regression — `src/main/services/webSearch/providers/__tests__/ApiProviders.test.ts`: both reporter shapes (empty content and empty results with failed status) preserve the classification through the real adapter.
- Regression — `src/main/ipc/handlers/__tests__/webSearch.test.ts`: exact typed context mapping, serializable domain code, unrelated errors unchanged, and void success.
- Regression — `src/renderer/pages/settings/WebSearchSettings/__tests__/useWebSearchProviderCheck.test.ts`: probe routing, real English interpolation, failure description, checking-state cleanup, and generic failure wording.

Electron toast visibility, live-provider crawlability, and Windows behaviour need separate runtime verification.
