# Agent Note: Name website uploads and optionally crawl same-origin links

Status: proposed

English | [中文](2026-11-12-website-upload-naming-auto-link-crawling.zh.md)

## Problem

Knowledge base URL items record only the URL. After upload, the listing shows the captured page title or a host-and-path slug, which is hard to match to the article a user meant to organize. Uploading an index or table-of-contents page also indexes only that single page, so the linked articles must be added one by one.

Issue [#19063](https://github.com/CherryHQ/cherry-studio/issues/19063) asks for two things: a user-chosen name for a website upload, and automatic capture of the internal links on an uploaded page.

## Proposal

**Naming.** Add an optional `name` to `UrlItemDataSchema` (`src/shared/data/types/knowledge.ts`). The add dialog gets a name input for URL sources. When `name` is set, it is used as the snapshot title in the frontmatter and as the file stem; when empty, the existing title derivation in `urlSnapshot.ts` applies unchanged. The field is stored in the item's JSON `data`, so no migration is needed.

**Crawling.** Crawling is opt-in per upload: the add dialog gets a "Also add linked pages on this site" checkbox, off by default. When enabled, the uploaded page's Markdown is scanned for links, and each link that satisfies all of the following becomes a child item under the uploaded item's group:

- same origin as the uploaded URL (scheme, host, and port must match);
- absolute HTTP or HTTPS after resolution;
- not a fragment-only link to the same page;
- not already scheduled in this upload.

Crawl depth is 1: only links on the uploaded page are followed. Each upload creates at most 20 items in total, including the uploaded page; links beyond that cap are dropped before any fetch is enqueued. Child items use the same fetch, snapshot, and indexing path as a manual URL item and receive derived titles; the custom name applies only to the uploaded item.

Child pages reuse the existing group-owner pattern (`groupId`) so deleting the uploaded item removes its children, as for other expanded sources.

## Alternatives considered

- **Title override only, no stored field.** Avoids a schema change, but the name would be lost on re-capture and could not be shown distinctly from the page title. Rejected because the issue asks for a name the user controls.
- **Crawl by default.** Would fan out one upload into up to 20 fetches without consent. Rejected; the user opts in per upload.
- **Same domain including subdomains.** Broader coverage for documentation sites split across subdomains, but it widens the fetch surface. Rejected for the first version; it can be added later as a separate choice.
- **Parse HTML links instead of Markdown links.** The fetch path returns Markdown only, so links are read from Markdown link syntax. Pages whose links exist only in non-Markdown output are not covered.
- **Recursive crawl.** Deeper coverage, but unbounded growth and harder cancellation. Rejected; depth is 1.

## Acceptance criteria

- AC1 — A URL upload with a non-empty name stores it, and the snapshot title and file stem use it; an empty name falls back to the existing derived title. (verification: unit + renderer)
- AC2 — URL items saved without a `name` still parse and index with unchanged titles. (verification: unit)
- AC3 — A URL upload with the crawl option off creates exactly one item. (verification: renderer + unit)
- AC4 — With the crawl option on, same-origin absolute HTTP(S) links on the uploaded page become grouped child items; cross-origin links, non-HTTP links, fragment-only links, and duplicates create no items. (verification: unit)
- AC5 — One upload creates at most 20 items including the uploaded page, and links beyond the cap trigger no fetch. (verification: unit)
- AC6 — A failed child fetch marks only that child failed; the uploaded item and its sibling children continue. (verification: unit)
- AC7 — Deleting the uploaded item removes its crawled children. (verification: unit)

## Risks

- A same-origin site can still be large; the 20-item cap bounds the cost per upload, not the total across uploads.
- Markdown link extraction depends on the reader's output; a page whose links are rendered only by JavaScript yields no children.
- Child pages may be duplicates of pages already in the base; duplicate detection against existing items is out of scope for this Spec.
