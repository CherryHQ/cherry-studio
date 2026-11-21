# Agent Note: Native message appearance controls

Status: proposed

English | [中文](2026-11-22-message-appearance-controls.zh.md)

## Problem

Issue #12917 requests native controls for message avatars, provider names, role-specific backgrounds and timestamps, and thinking/search spacing. Custom CSS currently makes these choices depend on internal markup. The shared message settings and render configuration should own them instead.

## Proposal

Add independent user and assistant/model avatar and timestamp switches, a provider-name switch, independent user and assistant background switches, and four numeric controls for the top/bottom spacing of thinking and built-in/provider search components. Expose the same controls in Settings > Appearance and the shared chat preference panel, with searchable settings anchors and translated accessible labels.

Persist the values through the existing Preference service, generated from `scripts/data-classify/data/target-key-definitions.json`. Avatars and timestamps default to visible; provider names and assistant backgrounds default to hidden. A nullable user-background override follows the selected plain/bubble style until explicitly changed, preserving current defaults. Once changed, that explicit choice applies independently of the layout. No message data or historical snapshots are rewritten.

The shared render-config hook resolves the layout-dependent default and distributes saved changes to current and remounted lists. The header and right-aligned user layout both honor avatar visibility without leaving an empty avatar column or an offset footer. Hiding timestamps must not hide token usage, selection, delivery attribution, or message actions. Provider labels use the producing model's provider identity, the current display-name resolver, and the provider identifier if its configuration has been removed.

Use the existing semantic muted surface for backgrounds. Keep message editing, attachments, horizontal multi-model scrolling, and user bubble layout independent from whether that surface is painted. Avatar control includes the secondary model identity icon.

Spacing accepts whole pixels from 0 to 32. Normalize imported values to these bounds, fall back on invalid numbers, and use zero above/two below for thinking and one above/below for search as compatibility defaults. Apply search spacing to pending, failed, empty, opaque provider, and successful result states. Ensure nested process CSS does not override the saved thinking margins. Content-only reasoning/search presentations must have the same effective spacing without double-applying it inside a disclosure.

No custom colors, per-message overrides, provider renaming, export styling, generic MCP tool spacing, or future unspecified controls are included. Those can be proposed separately.

## Alternatives considered

- Keep custom CSS: no native discovery or persistence contract, and selectors remain fragile.
- Couple backgrounds to plain/bubble style permanently: prevents the independent choices requested by the issue.
- Give user backgrounds one boolean default for both layouts: silently changes either current plain or current bubble rendering. A nullable initial override avoids that change.
- Store presentation choices on messages: duplicates global preferences and rewrites historical data without a content change.
- Add arbitrary spacing or color strings: expands validation, theme, and support scope beyond the requested controls.

## Acceptance criteria

- AC1 — Both settings surfaces expose accessible, translated, searchable controls; saved choices survive remount/restart and appear in other message lists without changing unrelated preferences. (verification: renderer and Electron)
- AC2 — Independent user/model avatar choices cover plain and bubble layouts, including secondary model icons, with no empty avatar column, clipped content, or incorrect footer offset at narrow widths. (verification: renderer and Electron)
- AC3 — Provider labels identify the producing model's provider, resolve configured names, fall back after provider deletion, and remain absent from user messages or when disabled. (verification: renderer)
- AC4 — User and assistant backgrounds toggle independently in both layouts while existing defaults, attachments, editing, and multi-model scroll remain intact. (verification: renderer and Electron)
- AC5 — User/model timestamp choices remain independent and do not remove token usage, delivery attribution, selection, or message actions. (verification: renderer and Electron)
- AC6 — Thinking/search top and bottom spacing uses bounded saved pixels across disclosure/content-only and search status variants, including nested processes, in light/dark and narrow layouts. (verification: unit, renderer and Electron)
- AC7 — Generated preferences, all locale catalogs, bilingual user documentation, and existing affected consumers pass scoped checks; the final implementation reports native acceptance separately and remains proposed until its native criteria are verified. (verification: docs gate and scoped checks)

## Risks

The two user layouts and nested process rules can mask a control even when settings save correctly. Verify rendered pixels and interactions, not only preference writes or CSS class presence. Cover both default-preserving upgrades and explicit overrides after layout changes.

Provider configuration can disappear while the model snapshot remains. Do not substitute a current default provider for historical identity. Treat provider-name resolution as display-only.

A renderer fixture can prove actual component composition and preference propagation but does not prove the Electron preload, database persistence, or operating-system runtime. Missing native libraries are an explicit verification boundary, not permission to bypass guards or claim completion.
