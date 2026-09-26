---
name: a11y-gate
description: ALWAYS invoke when building or changing UI on ANY surface (React/Tauri or Flutter), before calling it done — run the cross-surface WCAG 2.2 AA checklist. A PostToolUse hook flags UI edits that skipped this gate. Triggers on accessibility, a11y, WCAG, screen reader, keyboard navigation, focus, aria, Semantics, contrast, alt text, reduced motion, tab order, accessible name, focus trap.
---
<!-- TJ-ARCH-MOB-001 compliant -->

> **Binding:** Prefer simple, surgical, strongly typed changes; preserve strict
> layering and verify dependency versions. When installed in a project, also
> obey that project's `AGENT_BASE_RULES.md`; this skill remains self-contained.

# Accessibility Gate (WCAG 2.2 AA)

Accessibility is half of "done" on every UI surface. This gate is the cross-surface WCAG
2.2 AA checklist. A `PostToolUse` hook reminds you to run it after a UI edit — but the hook
only reminds; you run the checks.

## Cross-surface checklist (both React/Tauri and Flutter)

- [ ] **Contrast ≥ AA** — 4.5:1 body text, 3:1 large text / UI components / focus
      indicators, in BOTH themes. Tokens come from [[hybrid-design-tokens]]; verify the
      resolved pairs, not just the token names.
- [ ] **Every actionable element has an accessible name** and a visible label or
      tooltip — no icon-only buttons without a name.
- [ ] **Keyboard reachable and operable** — full flow with Tab/Shift-Tab/Enter/Escape;
      logical focus order; no keyboard trap; visible focus ring.
- [ ] **Images/media have alt/label** — decorative marked as such; informative described.
      (`image` [[content-block-ui]] blocks: `alt` is mandatory.)
- [ ] **Reduced motion honored** — respect `prefers-reduced-motion` (web) /
      `MediaQuery.disableAnimations` (Flutter); provide a non-motion path.
- [ ] **Live regions announce streaming** — streaming `text`/`thinking` and status changes
      on `toolUse`/`skill` are announced (aria-live / Flutter `liveRegion` Semantics),
      politely, without spamming.
- [ ] **Target size ≥ 24×24 CSS px** (AA 2.5.8), ≥ 44px recommended for primary touch.
- [ ] **Status not by color alone** — pair color with icon/text (tool status, sync chip).

## React / Tauri specifics

- Use semantic HTML first (`<header>`/`<nav>`/`<main>`/`<button>`), ARIA only to fill gaps.
- Run an automated pass (axe via BrowserClaw/Playwright) at review time — see
  [[tauri-ui-review]] — but never treat automated pass as sufficient; do the keyboard walk.

## Flutter specifics

- Wrap meaningful widgets in `Semantics` with `label`/`hint`/`button`/`liveRegion`.
- Verify with the accessibility inspector; add a11y assertions to goldens where practical —
  see [[flutter-golden-ui]].
- Respect `MediaQuery.textScalerOf(context)` — layouts must not overflow at large text.

## The hook

The scaffolded project installs a `PostToolUse` hook (matcher: `Write|Edit`) that, when a UI
file is touched (`.tsx`/`.jsx` under `src/`, `.dart` under `lib/`), prints a reminder to run
this gate. It is advisory (non-blocking) — it does not judge the code, it ensures the gate
isn't silently skipped.

## Related skills

- accessibility-agents / claude-a11y-skill (external) — deeper WCAG tooling
- [[hybrid-design-tokens]] — contrast source of truth
- [[tauri-ui-review]] / [[flutter-golden-ui]] — where a11y checks run per surface
- [[content-block-ui]] — per-variant a11y (alt text, live regions, focus)
