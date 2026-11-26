---
name: product-guide
description: Design, build, or review a one-time in-app guide in Cherry Studio — a spotlight coachmark on a moved entry point, a changed default, or a capability users would not find, or a dialog that introduces newly unlocked content. Use when a change moves UI, changes a default users rely on, or ships something hard to discover, and whenever a guide's design, data, behavior, or Electron verification is in question.
---

# Product Guide

A guide tells users, once, where something is or what changed. It must look like part of Cherry Studio, show real data, never disturb the UI it points at, and never come back after it is dismissed.

**Reference implementation:** the Cherry Cloud plan activation guide from [#24425](https://github.com/CherryHQ/cherry-studio/pull/24425). Its files exist on `main` once that PR merges; until then read them on the PR branch. Before that merge, `main` has an older, toast-only `useCherryCloudSubscriptionReminder.ts` that is not the reference. The design reference repeats the essential structure so this skill works without them.

- `src/renderer/windows/main/subscription/CherryCloudPlanActivationDialog.tsx`: the decision dialog and its abstract illustration.
- `src/renderer/components/cherryCloud/CherryCloudModelGuide.tsx`: the anchored spotlight guide.
- `src/renderer/windows/main/hooks/useCherryCloudSubscriptionReminder.ts`: detection, edition rules, and data derivation.

Match its size, type, spacing, and color unless a human asks otherwise. Exact values are in [design-reference.md](references/design-reference.md).

## 1. Decide whether a guide is warranted

Add a guide only when at least one is true:

- An entry point users already use moved or was renamed.
- A default users rely on changed and the new behavior is visible to them.
- A newly unlocked capability works only if users find a control they have no reason to open.

Do not add one for a new feature that sits where users already look, for copy tweaks, or for anything a toast or an inline empty state already explains. One change gets at most one guide.

Choose the audience. A guide about changed or moved behavior is for upgraded users only: fresh installs never saw the old UI. A guide about newly unlocked content follows the event that unlocked it.

Decide eligibility from the user's own state, not from a missing seen flag: renderer persist cache is empty on both a fresh install and an upgrade. Mark the guide due at the moment that changes the user's experience, and show it only while that due record exists. When that moment is in the renderer (an unlocking event, a renderer-side check of the user's stored setting), write the due record there. When only the main process knows (a data or preference migration), main cannot write renderer persist cache. If the migrated state still tells upgraded users apart from fresh installs, read that. If it does not (for example, both end up with the same preference value), the guide needs a marker written by the migration; that is a new channel, so stop and ask a human before adding it.

If the moved control is driven by a user-customizable default (a preference such as pinned toolbar items), changing the default does not affect existing users. That needs a migration and a product decision about whose settings to rewrite; raise it with a human before designing the guide.

## 2. Locate the target in the real UI

- Read the target component's source and take a current screenshot from a running dev instance (`cherry-electron-dev`). Name the exact component and element the guide points at. Never place a guide from memory or from an older design.
- Do not modify the target component's look, layout, or behavior. The only allowed change is exposing an anchor: an optional ref prop or a `data-*` attribute.
- If the guide triggers an action (for example switching a model), route it through the target's own handler so its state reconciliation stays in one place.

## 3. Preview before code

For any guide with visible UI, produce light and dark preview screenshots (an HTML mock or a dev-instance capture) and get explicit human agreement before implementing. Iterate on the preview, not on shipped code. Save the screenshots under `.context/`.

## 4. Design rules

- **One spotlight, one card, one primary action.** Dim the window except a padded cutout around the target, and anchor a single card to the cutout. Do not add pulse rings, outlines on the target, a second action button, or a full-window dim without a cutout.
- **Dismissal.** The card's action button, an outside click, a click on the target, and Escape all dismiss it. Never block the user: the dim layer stays `pointer-events-none`, so a click on the target also runs the target's own action, and an outside click also reaches whatever is underneath. Both are intended.
- **Type.** Body text is `text-xs` (12px) and titles are `text-sm font-semibold` (14px). Never use 10/11/13px or `text-base` and larger inside a guide. When a card feels too large, reduce width and padding, not the type scale.
- **Placement.** The reference values fit a target near the top of the window. Adapt them without asking: put the card on the side with room (`top` for targets near the bottom, such as the composer), align its edge with the cutout (`alignOffset` equal to minus the cutout padding for `align="start"`), and set the cutout radius to the target's radius plus the padding, or `rounded-full` for a round button.
- **Size.** Guide cards are `w-76` (304px) wide; height follows content (a text-only card has no preview strip and is shorter). Dialogs are 340px wide. Checkbox and button labels fit on one line; descriptions take at most two lines in English.
- **Color.** Use neutral surface tokens and the shared `emphasis` button. `primary` appears only as a thin selection indicator. No gradients, colored tags, or ad-hoc `dark:` overrides.
- **Illustration.** Default to none for anchored guides; the spotlight already shows the target. A dialog or where-is-it guide may reuse the abstract illustration from the reference dialog. A new illustration must follow the rules in the design reference: interface structure only, tokens only, and a ground visibly distinct from the card in the dark theme.
- **Copy.** Short and specific: what changed, where it is now, one action. Never name a plan or tier, never mention another plan, and never state numbers or names that are not in live data.

## 5. Data

Skip this step if the guide shows no models, plans, quotas, or dates; still check both editions for layout differences near the target.

- Take every model, plan, quota, and date from live API data. Check the public catalog (for example `GET /api/v1/public/plans` on the edition's Cherry Cloud origin) or the signed-in account response; never invent sample content. Seed dev-profile test data from those real values.
- Confirm what each field means before showing it. Example: a monthly subscription returns no entitlement `expires_at`; its date is the `subscription_month` quota window's `period_end`.
- Use the endpoints the feature already calls. Do not add a server or IPC endpoint for a guide unless a human asks for it.
- Check the China and global editions separately. Their API origins, catalogs, and notification behavior differ.

## 6. Behavior

- **Once.** Keep the guide's state in renderer persist cache (`ui.<feature>.*`) and update it on every dismissal path.
  - Event-driven guide (due once, when an event happens, as in the reference): one record, set by the event, shown while set, and cleared on dismissal. The reference uses `ui.cherry_cloud.model_guide`.
  - State-derived guide (due because of stored state that is re-checked on every launch): also keep a `seen` flag, set it on dismissal, and check it before showing. Otherwise the next launch re-derives the guide and it returns.
- **Side effects once per guide.** A handler passed from a parent is often recreated while the action it started is still in flight. Guard by the target id (for example `attemptedModelIdRef`), never by handler identity, or the guide re-fires the action and loops with "Maximum update depth exceeded".
- **Wait for readiness.** Show only on the active tab, after the target has mounted and finished loading, and while no mandatory gate (`useMandatoryGateOpen`) or other dialog is open.
- **No stacking.** When a guide replaces an existing toast or notice, show one or the other, never both. Respect edition suppressions: while the China edition's notification center is live, it alone announces subscription changes.

## 7. i18n

Add keys to `src/renderer/i18n/locales/en-us.json`, run `pnpm i18n:sync`, translate every locale, and run `pnpm i18n:check`. Format dates with `Intl.DateTimeFormat(i18n.language, …)`.

## 8. Tests

Write contract tests, not behavior pins:

- The guide shows once and never again after each dismissal path.
- An upgraded-user guide stays hidden for a fresh install.
- A due guide waits while a gate or another dialog is open.
- Any triggered action runs once when the parent re-renders with a new handler identity. Confirm this test fails without the guard. Not applicable when the guide triggers no action.
- Edition and data rules: the replaced toast does not also appear, edition suppression holds, and date or model derivation handles missing fields.

Run them with explicit paths (`pnpm test:renderer <files>`).

## 9. Verify in Electron

Follow `cherry-electron-dev`: one dev instance at a time, a dedicated `CS_DEV_USER_DATA_SUFFIX` profile, and CDP for driving the app.

1. Seed the profile with the real data from step 5, or with the user state that makes the guide due when the guide shows no data.
2. If the guide needs an event you cannot trigger locally, add a temporary trigger marked `// TEMP-VERIFY`. It must never be committed.
3. Capture light and dark screenshots. If the guide shows model or provider icons, wait until they finish loading: a letter avatar means the lazy icon had not loaded yet; recapture instead of reporting it.
4. Run the visual checklist in [design-reference.md](references/design-reference.md), including the measured cutout alignment.
5. Exercise every dismissal path, then confirm the guide stays gone after a reload, and after a full app relaunch for a state-derived guide.
6. Restore any preference you changed (for example `ui.theme_mode`).

## 10. Before commit

- `grep -rn "TEMP-VERIFY" src` returns nothing.
- Stop your dev instance and confirm none of yours remain.
- Run scoped tests, type check, lint, format, and `pnpm i18n:check` on the changed files.
- Report in the PR which checks and Electron scenarios actually ran, which data was live and which was seeded, and what remains unverified (for example, no real signed-in account).
