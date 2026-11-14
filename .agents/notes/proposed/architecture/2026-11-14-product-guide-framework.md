# Agent Note: Product guide framework

Status: proposed

English | [中文](2026-11-14-product-guide-framework.zh.md)

## Problem

When a release changes a default or moves a feature, upgraded users lose track of it and nothing tells them. The renderer has no shared mechanism for one-time, in-context guidance. Each feature owns an ad-hoc seen flag (`ui.cherry_cloud.subscribe_prompt_seen`, `ui.cherry_cloud.model_guide`), and the subscription model guide hand-builds its spotlight and threads a trigger ref through `ChatConversationControls`. A new guide today means copying that component, and nothing prevents two guides from stacking or a guide about changed behavior from reaching fresh installs that never saw the old behavior.

## Proposal

- **Coachmark UI.** A `Coachmark` composite in `@cherrystudio/ui` dims the window except a padded cutout around the target and anchors a popover aligned with the cutout. It closes on its action, an outside click, a click on the target, or Escape. It uses the shared body type scale and works in light and dark themes. An optional header slot takes an illustration; anchored guides default to text only, because the spotlight already shows the target.
- **Illustration.** The subscription activation sketch becomes a reusable abstract illustration for the header slot and for feature dialogs. It draws interface structure only, with placeholder bars, dots, and a selected row, and never shows logos, model icons, plan or tier names, or real model names. It uses only shared surface tokens (`bg-muted` ground, `bg-popover` cards with `ring-border`, `bg-accent` selection, `primary` as the sole accent) without `dark:` palette overrides. Its ground is separated from the card by a border so it stays distinct in the dark theme. It scales as a whole to the header height, keeps decoration to a dot grid and at most two sparkles, and limits motion to one entrance animation that respects `motion-reduce`.
- **Registry.** One renderer module declares every guide: `id`, the `since` app version, `audience` (`upgraded` or `everyone`), the anchor key, and its i18n keys. Targets opt in with a `data-guide-anchor="<key>"` attribute instead of refs threaded through props.
- **Coordinator.** The main window shows at most one guide at a time, and only when its anchor is visible on the active tab, no mandatory gate is open (`useMandatoryGateOpen`), and no dialog is open. Seen guide ids persist in the renderer persist cache key `ui.product_guide.seen`; each guide shows once.
- **Audience.** An `upgraded` guide shows only to users who ran a version older than its `since`. On first run the renderer stores `ui.product_guide.baseline_version`: the previous app version from the existing `version.log` (`VersionService.getPreviousVersion`), or the current version for a fresh install. A guide is eligible when `since` is newer than the baseline. The previous version reaches the renderer through one read-only IpcApi route; main writes no new record.
- **Scope.** Feature dialogs that ask the user to decide something, such as the plan activation dialog, stay with their features. The framework covers anchored one-time guidance only. A feature may request a registered guide imperatively, as the subscription flow does after its dialog.
- **Migration.** After the subscription activation guide (#24425) merges, its chat header guide moves onto the framework. `ui.cherry_cloud.model_guide` keeps only the pending model choice, and `ChatConversationControls` drops its `modelTriggerRef` prop.
- **Repository skill.** `.agents/skills/product-guide/` tells agents what to do when a change alters a default, moves an entry point, or ships a capability users would not find: decide with a checklist whether a guide is warranted, register it, write copy within the rules (short, no plan or tier names, shared type scale), reuse the shared illustration or add one under the illustration rules only when a dialog or a where-is-it guide needs it, add `en-us` strings and translate every locale, write contract tests (shown once, hidden from fresh installs for `upgraded`, deferred behind gates), and verify in Electron with light and dark screenshots, a cutout alignment measurement, and a check that the illustration ground stays distinct from the card and shows no concrete names.

## Alternatives considered

- A tour library such as react-joyride or driver.js: it adds a dependency with its own styling and stacking model, while the need is one anchored callout at a time that follows `@cherrystudio/ui` tokens and the existing mandatory gate.
- Seen state in Preference: it would sync across windows and survive storage resets, but guide state is losable UI state, and Preference is reserved for user settings.
- A new persisted first-installed-version record: `version.log` already records every version change, and the previous version read once is enough to set a baseline.
- Plan-specific artwork or model logos in illustrations: plans and their models change, and each plan targets users who must not see another plan's name.
- A skill without shared code: agents would copy the subscription guide each time and repeat its alignment and stacking problems.

## Acceptance criteria

- AC1 — A registered `everyone` guide shows once on its anchor when the anchor is visible on the active main-window tab, and never again after any dismissal path: action, outside click, target click, or Escape. (verification: renderer)
- AC2 — An `upgraded` guide shows to a user whose baseline version is older than its `since`, and never to a fresh install of `since` or later. (verification: renderer)
- AC3 — While a mandatory gate or another guide is open, a due guide waits and shows after it closes; at most one guide is visible at a time. (verification: renderer)
- AC4 — The coachmark popover aligns with the spotlight cutout, uses only the shared body type scale, and is legible in light and dark themes. (verification: Electron)
- AC5 — The subscription model guide runs on the framework with unchanged behavior, and `ChatConversationControls` no longer accepts a trigger ref. (verification: renderer + Electron)
- AC6 — `.agents/skills/product-guide/SKILL.md` is listed in `public-skills.txt`, passes `pnpm skills:check`, and documents the decision checklist, registration, copy rules, illustration rules, i18n, tests, and Electron verification. (verification: CI gate)
- AC7 — The shared illustration renders in the coachmark header slot and the subscription activation dialog, uses only shared surface tokens with no concrete names, and its ground stays distinct from the card in light and dark themes. (verification: renderer + Electron)

## Risks

- Clearing renderer storage resets seen guides and recomputes the baseline from the previous version, so a user may see a recent guide again.
- A guide depends on its anchor staying mounted; renaming or removing the anchor silently disables the guide, so the skill requires a test per anchor.
- AC5 depends on #24425 merging first; until then the subscription guide keeps its own implementation.
