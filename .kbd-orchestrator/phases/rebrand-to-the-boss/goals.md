# Goals

Rebrand this CherryStudio v2.x fork as **The Boss**, disconnect it from upstream
Cherry services, and establish a merge discipline that lets us keep consuming
upstream v2.x without clobbering fork-only work.

## Context discovered during phase creation

- **Prior art exists.** `/Users/gqadonis/Projects/references/baseline/cherry-studio`
  (v1.9.11, branch `main`) is an *already-rebranded* fork. It carries
  `productName: The Boss`, `appId: tools.know-me.the-boss`, Boss logo/icon assets,
  and its own update feed at `https://the-boss.know-me.tools`. 357 files there
  reference the Boss branding. Port from it; do not reinvent.
- **A proven upstream-merge playbook exists.** That repo's
  `.kbd-orchestrator/phases/upstream-1.9.x-merge-strategy/` documents a direct-merge
  strategy (not rebase, not cherry-pick) that preserved branding through upstream
  v1.9.7, including the exact conflict set. Adapt it to v2.x.
- **Scope here is large.** 4306 `Cherry*` occurrences across 2061 files in `src/`.
- **Upstream services to sever.** 15+ domains, highest-volume first:
  `open.cherryin.net` (65), `open.cherryin.ai` (31), `cherry-ai.com` (31),
  `express-ent-admin.cherryin.ai` (19), `docs.cherry-ai.com` (17),
  `cloud.cherryai.com.cn` (12), plus `releases.cherry-ai.com` and
  `analytics.cherry-ai.com`.
- **Two i18n trees**, both sourced from `en-us.json`, 10 locales:
  `src/renderer/i18n/locales/` and `src/main/i18n/locales/`.
- **A possible theming hook already exists:** `CHERRY_EDITION` (`global` | `cn`)
  drives `pnpm build` vs `build:cn`. Evaluate whether branding belongs in that
  mechanism rather than in scattered literals.
- **Only remote is `origin`** (`Prometheus-AGS/the-boss`). No `upstream` remote is
  configured yet — required before any upstream-consumption work.

## Goals

- **G1 — Establish a branding indirection layer.** Route product name, URLs, and
  asset paths through a single fork-owned source of truth rather than editing 2061
  files in place. Evaluate `CHERRY_EDITION` as the carrier; if unsuitable, define a
  `branding` module. This goal is what makes G5 achievable — literals scattered
  across the tree guarantee merge conflicts forever.
- **G2 — Port The Boss visual identity** from the 1.9.x reference: `build/icon.{png,icns,ico}`,
  `logo.png`, `logo-lockup.png`, `tray_icon{,_dark,_light}.png`, `build/icons/`,
  plus `appId: tools.know-me.the-boss` and `productName: The Boss`. Verify assets
  render at every required size and on both themes.
- **G3 — Rebrand user-visible strings through i18n.** Update `en-us.json` in both
  trees, run `pnpm i18n:sync`, and translate every generated
  `[to be translated]:` placeholder across all 10 locales. `pnpm lint` must pass —
  it rejects leftover placeholders, empty values, interpolation mismatches, and
  unsorted keys. No hardcoded UI strings.
- **G4 — Sever upstream services and stand up our own.** Repoint update feed,
  docs, onboarding, and telemetry to Boss-owned endpoints
  (`the-boss.know-me.tools` per the 1.9.x reference). Telemetry to Cherry must be
  off by default — decide explicitly whether to disable or re-target it, and
  record the decision.
- **G5 — Make upstream v2.x consumable.** Add the `upstream` remote, adapt the
  reference repo's direct-merge playbook to v2.x, and document the conflict
  surface the branding layer deliberately shrinks. Prove it by dry-running a merge
  of current upstream `main` and recording what conflicts.
- **G6 — Verify the whole gate.** `pnpm build:check` green, app launches with Boss
  identity, no residual Cherry branding in user-visible surfaces, and no call-out
  to a Cherry-owned endpoint at runtime.

## Explicit non-goals

- Renaming internal code identifiers, package names (`@cherrystudio/*`), or import
  paths. That is churn that maximizes merge conflict surface for zero user-visible
  benefit. Fork identity lives at the presentation and configuration layer.
- Rewriting git history or squashing the existing fork commits.
- Adding fork-only features. This phase establishes the *substrate* that future
  fork-only work builds on.

## Open questions for /kbd-assess

1. **Is `CHERRY_EDITION` the right carrier for branding**, or does an edition axis
   (`global`/`cn`) conflict semantically with a fork-identity axis? A third edition
   value versus a separate `branding` module is the first real design decision.
2. **Does the 1.9.x → 2.x gap invalidate the reference port?** The reference is
   v1.9.11; this fork is v2.1.1 post-v2-refactor. Asset formats likely port cleanly;
   config and service wiring may not.
3. **Which Boss-owned endpoints actually exist today?** `the-boss.know-me.tools`
   appears in the 1.9.x config — is it live, and does it serve v2.x artifacts?
   G4 is blocked on real infrastructure, not just config edits.
4. **Telemetry: disable or re-target?** Affects `analytics.cherry-ai.com` and the
   Sentry wiring. A privacy-relevant decision that should be made deliberately.
5. **What is the actual upstream cadence?** Determines whether the merge discipline
   in G5 needs automation or stays manual.
