# Agent Note: Marketplace discovery and installation contract

Status: proposed

English | [中文](2026-11-07-skill-marketplace.zh.md)

## Problem

Users need one place to discover skills, Agent templates and MCP resources. A catalog entry is remote metadata, not an installed resource or permission to run it. Source labels must not change persisted identities or installation targets.

This document records the contract of the existing implementation in #20978 for review. It does not claim that the implementation has shipped or that this Spec has approval. The dependent personal-library draft #21834 keeps its own scope.

## Proposal

### Discovery and source identity

Expose Marketplace through Launchpad and the sidebar. The resource navigation contains All, Skills, Agents and MCP. The overview previews each resource type. Agent discovery combines Agent and Assistant presets; creation uses the existing dialogs and local choices.

| Source | Display | Identity and browsing |
|---|---|---|
| CherryIN | Curated | The selected source is `null`. Load popular skills in pages of 100, validate pagination and deduplicate IDs. Search filters the loaded catalog. Details can include a collection of skill directories. |
| skills.sh | skills.sh | Source ID `skills.sh`. Browse the all-time ranking by page. A nonempty query uses the source search adapter. |
| claude-plugins.dev | claude-plugins | Keep source ID `claude-plugins.dev` and the `/api/skills` endpoint. Advance the offset by the raw response count, not the number left after filtering. |
| User subscription | User-provided name | Keep a separate stored source ID and normalized URL. Adding a source does not install its entries. |

External catalogs share cards, details and installation state. Source identity participates in cache keys. Switching sources remounts the catalog so old results and an open detail do not leak into the next source. Search and browsing use different request paths; clearing search restores browsing. Load more uses the catalog cursor and the actual ScrollArea viewport.

For claude-plugins, installation uses `claude-plugins:owner/repo/directoryPath`; the directory comes from metadata, never from the displayed skill name. skills.sh uses its validated source handle. A card with an unsupported source cannot install. Display labels do not rewrite stored IDs, URLs or handles.

### Installation and subscription boundaries

Use existing skill commands and installer validation. Reading a catalog or opening details does not authorize execution of skill instructions. Installing a skill does not grant an Agent new tool permissions. Agent-specific enablement stays in the existing skill management flow.

CherryIN JSON reads reject bodies over 16 MiB. Package download, archive extraction, directory validation and installation remain in the main process. Keep archive size/path checks and rollback behavior; do not add a second installer. Collection actions retain per-member success and failure, so a failed member is not reported as installed.

Subscription URLs accept HTTP or HTTPS without embedded credentials. GitHub URLs are normalized. Refresh replaces catalog data, not installed files. Removing a subscription removes the source; it does not silently uninstall local skills. Catalog data is untrusted. A readable URL is not a guarantee that the publisher or its contents are safe.

### MCP management and layout

The MCP catalog retains its existing add/configuration flow. Manage MCP opens Settings with `mcpStandalone`. Keep the primary Settings navigation and content outlet; hide only the MCP submenu. That mode lasts for the current Settings instance, including leaving MCP and returning. A fresh ordinary Settings instance shows the normal submenu.

MCP controls use a title/search/add row and a filter/environment row. Preserve create, import and JSON export actions. Lists stretch inside the content area instead of relying on a fixed window height.

Keep the existing Store icon geometry and size. The selected icon uses inverse foreground/background treatment. Use shared ScrollArea for lists and horizontal source navigation. Virtual lists, pagination observers and scroll reset target its viewport. Preserve keyboard focus, accessible action names and detail-close focus restoration. Narrow-window, dark-theme and real scrolling checks remain explicit acceptance work.

### Failure and recovery

Loading, empty results and errors are distinct. A failed request shows retry rather than an empty success. Registry failures log source, cursor and the original error. Retain the source's failure semantics; do not increase a timeout or suppress an error without evidence.

Install actions show busy and installed states and prevent duplicate submissions. A failed installation reports failure and permits another attempt. Catalog retry does not imply reinstalling local content. Existing subscription snapshots can remain available while refresh is attempted.

## Alternatives considered

- Keep discovery in separate settings pages: rejected because users must know the source before they can browse it.
- Rename source IDs to match shorter labels: rejected because cache identity and exact installation targets must remain stable.
- Build a parallel installer or persist the MCP layout mode globally: rejected because existing installation safeguards and ordinary Settings behavior already have owners.
- Include My Resources in this layer: rejected because its hidden navigation and editing behavior belong to the separate draft #21834.

## Acceptance criteria

- AC1 — Users can browse CherryIN, skills.sh and claude-plugins, search, open details and load subsequent pages without crossing source identity. (verification: unit and renderer; owner: Frontend)
- AC2 — Installs use the validated exact directory; duplicate submissions are blocked and collection failures remain visible. Catalog reads never execute skills. (verification: unit and main-process integration; owner: Backend)
- AC3 — Adding, refreshing or removing a subscription does not silently install, update or uninstall local skills. (verification: unit and renderer; owner: Backend and Frontend)
- AC4 — Marketplace MCP management hides only its submenu for the current Settings instance; ordinary Settings retains the submenu and create/import/export actions. (verification: renderer and Electron; owner: Frontend)
- AC5 — Store icon geometry, keyboard actions, detail focus return and viewport-based pagination work in light/dark and narrow windows. (verification: renderer and Electron; owner: Frontend and QA)
- AC6 — Loading, empty and failed catalogs remain distinguishable; retry and install recovery preserve the original failure. (verification: unit, renderer and controlled network failure; owner: Frontend and QA)
- AC7 — The documentation layer contains only this bilingual contract and its consistency record; implementation and personal-library changes remain separate. (verification: docs gate and parent-relative Git diffs; owner: Maintainer)

## Risks

Remote services may change schemas, slow down or become unavailable. An earlier intermittent catalog failure was not reproduced; successful requests do not establish its cause or prove a fix.

The local dependency installation is incomplete. Standard tests can fail before collection because the installed Claude SDK differs from the manifest. Isolated checks do not certify the standard suite, packaged application or real skill installation. Current-head Electron, dark/narrow-window and real installation acceptance remain unverified. Do not move this note to implemented until its acceptance evidence is complete.

Rollback follows the existing installation recovery behavior. Reverting a catalog UI change must preserve user-installed skills and subscriptions. No new database migration is part of this contract.
