# Tasks — rebrand-007-outbound-attribution

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## Status: closed out — mostly delivered early by rebrand-002

This change's purpose is how the app identifies itself **to third parties**: the
attribution headers sent to every AI provider, and the OpenAPI document title that
travels into generated clients.

`src/main/utils/http.ts` and the two `openapiDocs.ts` titles were migrated during
`rebrand-002-branding-module` as its proof-of-concept call sites, since the change
required "at least two call sites read from it".

## Gap found while closing out

Verification against the acceptance criteria found **one missed outbound string**
that the early migration did not cover:

`openapiDocs.ts:54` — `DOC_TAGS.cherry: 'Cherry Studio'`. This is an OpenAPI **tag
name**, and the surrounding comment is explicit that tag names "travel into the
machine-readable spec" and become module names in generated API clients. It is
outbound-facing identity, squarely in this change's scope. Now `PRODUCT_NAME`.

Two integration tests pinned the literal. Their intent — "tag names are canonical
identifiers, never translated, so generated clients keep stable module names" — is
still correct, so they now reference `PRODUCT_NAME` rather than asserting a brand.

## Evidence

- `http.ts` → `HTTP-Referer: ATTRIBUTION_URL`, `X-Title: ATTRIBUTION_NAME`
- `openapiDocs.ts` → 3 `PRODUCT_NAME` references (2 titles + the tag name)
- **Zero** `cherry-ai.com` / `Cherry Studio` literals remain in either file
- `providerAttributionHeaders` + `mcpTransport` → 20 passed
- `src/main/features/apiGateway` → **486 passed**, 0 failed

## Note

Closing this out is what surfaced the tag-name gap. Marking it complete on the
strength of the earlier migration alone would have shipped "Cherry Studio" as a
module name in every generated API client.
