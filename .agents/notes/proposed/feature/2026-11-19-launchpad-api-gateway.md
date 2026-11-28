# Agent Note: Launchpad access to the unified API gateway

Status: proposed

English | [中文](2026-11-19-launchpad-api-gateway.zh.md)

## Problem

Developers frequently start or stop the unified gateway and check its address, port and API key before connecting external tools. Its entry through Settings → Device connections is deep and cannot be pinned. Device connections links to the existing gateway settings page, which must remain available without regression.

## Proposal

Add an `api_gateway` built-in tile to the existing launchpad apps grid, as selected on decision card `cf395e0ca9f` for issue #24909. Add the value to both `SIDEBAR_FAVORITES` in `src/shared/data/preference/preferenceTypes.ts`, the upper bound for persisted values, and the renderer capability registry in `src/renderer/utils/sidebar.ts`. Retain the legacy `openclaw` persisted value.

The tile opens `/app/api-gateway`, served by `src/renderer/pages/apiGateway/ApiGatewayPage.tsx`. Its `PageHeader` and single `ScrollArea` use the height provided by the tab parent. Extract the existing gateway controls into `src/renderer/components/apiGateway/ApiGatewayPanel.tsx`; the Settings page retains its shell, header, container, width and scroll structure and delegates to the panel. Pages do not import other pages.

The shared panel shows running state, address, port and API-key readiness and starts or stops the gateway using `useApiGateway`, the existing `api_gateway.start` and `api_gateway.stop` IPC commands, and `feature.api_gateway.*` preferences. Preserve the existing control behavior. Reuse `code.api_gateway.title` for the tile, sidebar and page title, and existing `apiGateway.*` and common strings for the panel. Add no IPC, preference migration or locale keys.

Pinning uses the existing sidebar-shortcut mechanism. Launchpad and sidebar open the same route and component; the tab runtime retains its current replace-or-open rules, with no global single-tab guarantee. There is no auto-pin or new mini app.

Two manual synchronization points have no type guard: update `src/renderer/i18n/label.ts` for the sidebar label/icon key and `src/renderer/utils/routeTitle.ts` for the route title key, so tab titles re-localize when the language changes. The implementation regenerates `src/renderer/routeTree.gen.ts`, `resources/builtin-agents/cherry-assistant/product-manifest.json` and `docs/dev/sources-index.json`, and updates the entry paths and `sources` in `docs/dev/references/api-gateway/README.md`.

## Alternatives considered

A first-class sidebar app entry or promotion within Settings adds another persistent navigation surface without providing the chosen launchpad workflow. Duplicating panel JSX risks divergent controls; importing the Settings page from the new page violates renderer boundaries. A full mini app adds an unnecessary registry and lifecycle. Auto-pinning changes existing user preferences without an explicit choice. One-time product guidance adds state for an entry that supplements the existing path.

## Acceptance criteria

- AC1 — The launchpad apps grid shows the unified gateway entry and opens its page (verification: renderer component tests and Electron smoke — launchpad and routing)
- AC2 — The panel starts and stops the gateway and shows running state, address, port and API-key readiness (verification: renderer component tests and Electron smoke — gateway panel)
- AC3 — The entry can be pinned to the sidebar, opens the same panel there, and remains in the launchpad after unpinning (verification: renderer component tests and Electron smoke — sidebar shortcuts and launchpad)
- AC4 — A stopped gateway shows an explicit state instead of a blank page (verification: renderer component tests and Electron smoke — gateway panel)
- AC5 — The existing Settings gateway entry and Device connections path retain their behavior (verification: renderer component tests and Electron smoke — Settings and Device connections)
- AC6 — The panel renders in light and dark themes and remains reachable in a short, narrow window (verification: Electron smoke and docs gate — gateway page and documentation)

## Risks

Extracting controls can change Settings behavior or expose a key unintentionally; test the existing masking and controls on both surfaces. A missed manual label or route-title mapping can leave an untranslated label or stale tab title. The parent-sized scroll area must keep all controls reachable at small window sizes. Regenerated artifacts and source-linked documentation must remain in sync with the new route.
