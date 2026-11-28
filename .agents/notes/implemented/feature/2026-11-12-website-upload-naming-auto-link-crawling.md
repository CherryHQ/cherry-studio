# Agent Note: Name website uploads and optionally crawl same-origin links

Status: implemented

English | [中文](2026-11-12-website-upload-naming-auto-link-crawling.zh.md)

## Problem

Knowledge base URL items record only the URL. After upload, the listing shows the captured page title or a host-and-path slug, which is hard to match to the article a user meant to organize. Uploading an index or table-of-contents page also indexes only that single page, so the linked articles must be added one by one.

Issue [#19063](https://github.com/CherryHQ/cherry-studio/issues/19063) asks for two things: a user-chosen name for a website upload, and automatic capture of the internal links on an uploaded page.

## Decision

**Naming.** Store an optional `name` to `UrlItemDataSchema` (`src/shared/data/types/knowledge.ts`). The add dialog gets a name input for URL sources. When `name` is set, it is used as the snapshot title in the frontmatter and as the file stem; when empty, the existing title derivation in `urlSnapshot.ts` applies unchanged. The field is stored in the item's JSON `data`, so no migration is needed.

**Crawling.** Crawling is opt-in per upload: the add dialog gets a "Also add linked pages on this site" checkbox, off by default. When enabled, the uploaded page's Markdown is scanned for links, and each link that satisfies all of the following becomes a child item under the uploaded item's group:

- same origin as the uploaded URL (scheme, host, and port must match);
- absolute HTTP or HTTPS after resolution;
- not a fragment-only link to the same page;
- not already scheduled in this upload.

Crawl depth is 1: only links on the uploaded page are followed. Each upload creates at most 20 items in total, including the uploaded page; links beyond that cap are dropped before any fetch is enqueued. Child items use the same fetch, snapshot, and indexing path as a manual URL item and receive derived titles; the custom name applies only to the uploaded item.

The ownership model extends `groupId` so an opt-in URL owns its direct URL children. `KnowledgeItemService.validateGroupOwnerTx()` validates the same base, live owner, same origin, unique URL, depth and cap. `prepareUrlCrawl` atomically creates children and marks expansion complete. Root indexing status remains independent; `crawlProgress` reconciles child completion, failures and removal, and directory ancestors retain descendant rollup. Deletion uses the existing recursive cancellation and cleanup path. Ordinary URL uploads remain single items.

Base restore remaps child ownership to newly accepted owner IDs and copies captured snapshots. Captured owners are marked expanded, so restore does not rediscover links or refetch saved pages. All restore copies finish before provider work is scheduled. The list opens opted-in URL owners as groups while keeping source preview in the context menu. The add form explains the per-URL depth/cap and possible provider-credit use.

## Alternatives considered

- **Title override only, no stored field.** Avoids a schema change, but the name would be lost on re-capture and could not be shown distinctly from the page title. Rejected because the issue asks for a name the user controls.
- **Crawl by default.** Would fan out one upload into up to 20 fetches without consent. Rejected; the user opts in per upload.
- **Same domain including subdomains.** Broader coverage for documentation sites split across subdomains, but it widens the fetch surface. Rejected for the first version; it can be added later as a separate choice.
- **Parse HTML links instead of Markdown links.** The fetch path returns Markdown only, so links are read from Markdown link syntax. Pages whose links exist only in non-Markdown output are not covered.
- **Directory container for each crawl.** This would keep the current directory-only owner validation, but deleting the uploaded URL would no longer by itself delete its siblings under that container. Rejected because AC7 makes the uploaded URL the deletion owner.
- **Recursive crawl.** Deeper coverage, but unbounded growth and harder cancellation. Rejected; depth is 1.

## Consequences

- A same-origin site can still be large; the 20-item cap bounds the cost per upload, not the total across uploads.
- Markdown link extraction depends on the reader's output; a page whose links are rendered only by JavaScript yields no children.
- Child pages may be duplicates of pages already in the base; duplicate detection against existing items is out of scope for this Spec.

## Verification

- AC1 — downstack naming implementation #25113 at `65588e78e99deaa840c26f025657d6595232b976`, with schema, snapshot, index-handler, SQLite persistence, restore and renderer regressions rerun in this layer.
- AC2 — `knowledge.test.ts`, `urlSnapshot.test.ts` and `indexDocumentsJobHandler.test.ts` preserve unnamed stored URL parsing and title/index behavior.
- AC3 — the default-off renderer submission tests and the actual-service crawl-off index test create only the uploaded item.
- AC4 — `urlLinks.test.ts` covers Markdown/reference/relative links, normalization, exclusions and the 19-child limit. `KnowledgeItemService.test.ts` verifies transactional ownership, deduplication and the total cap, including existing children. `urlCrawl.integration.test.ts` observes exactly 20 fetch attempts and no grandchildren.
- AC5 — The SQLite ownership tests include pre-existing children in the 20-total cap, and the actual-service job integration test makes exactly 20 fetch attempts, with no fetch or enqueue beyond 19 direct children.
- AC6 — the actual-service integration tests isolate one child provider failure and a separate child enqueue failure while root and siblings continue.
- AC7 — actual-service index/delete tests cancel 19 queued children and remove their migrated-SQLite subtree, preserving unrelated jobs; capture/delete races enqueue no work. Ownership tests reject cross-base/deleting owners and reconcile progress after status changes and deletion.
- Regression — restore copies root and child snapshots under a remapped owner, and asserts every copy precedes indexing enqueue. Captured restored owners do not crawl again. Renderer tests cover grouped navigation, polling and reset.
- Regression — 516 tests passed across 15 selected main, renderer and shared files; 12 existing cases remain skipped. Actual add-dialog fixtures in English/light at 900px and Chinese/dark at 390px and the actual owner-row fixture were visually inspected. Provider, vector-store and capture seams in the integration tests are mocked; no live/paid provider request or full native application run is claimed.
