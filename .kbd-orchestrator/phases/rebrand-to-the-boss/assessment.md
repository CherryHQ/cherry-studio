# Assessment — rebrand-to-the-boss

**Phase:** rebrand-to-the-boss
**Date:** 2026-09-21
**Backend:** native KBD (OpenSpec initialized this session, no specs authored yet)
**Goals:** [goals.md](./goals.md)
**Model preflight:** `status: ok`, 2 distinct models (adversarial review viable)

---

## 1. Headline finding — the phase premise changed

`goals.md` was written assuming this fork already carried some Boss identity. It does
not. **This fork is branding-virgin.**

```
appId:       com.kangfenmao.CherryStudio
productName: Cherry Studio
updater:     http://127.0.0.1:3378        (upstream dev placeholder)
```

`grep -rilE 'the.?boss|know-me'` across `package.json`, `electron-builder.yml`,
`dev-app-update.yml`, `README.md`, and `src/` returns **zero** matches.

Divergence from upstream `CherryHQ/cherry-studio@main`:

| | |
|---|---|
| Upstream ahead of us | **3 commits** |
| We ahead of upstream | **4 commits** — all KBD/OpenSpec scaffolding from today |
| Merge base | `9e2a8d4923` (upstream `#20873`) |

So the fork has **no fork-only product code at all**. Every one of our 4 commits is
agent tooling. This is the cleanest possible moment to rebrand: there is no
fork-unique functionality to protect yet, and G1's indirection layer can be built
*before* divergence accumulates rather than retrofitted.

**Consequence for G5:** the "consume upstream without breaking the fork" problem is
currently hypothetical. The discipline we establish now determines whether it stays
cheap. This raises G1's priority from "helpful" to **prerequisite**.

---

## 2. Directive 1 — stay on latest upstream

**Status: nearly current; trivially closable.**

- Newest upstream tag is `v2.1.1`; our `package.json` says `2.1.1`. But the `v2.1.1`
  **tag object is not an ancestor of our HEAD** — we forked from `main` slightly
  before it was cut.
- The 3 commits we lack:
  - `c3eda0c2b2` feat(code-cli): add MiniMax Code CLI management (#20849)
  - `50b500df54` fix(api-gateway): project native Anthropic effort onto resolved model vocabulary (#20811)
  - `38beb6050c` fix(release-workflow): allow preparation after release withdrawal (#20888)
- **No `upstream` remote is configured.** Only `origin`
  (`Prometheus-AGS/the-boss`). I fetched upstream into a throwaway
  `refs/remotes/_probe/main` for measurement; a permanent remote is a G5 deliverable.

**Gap G5.1:** add `upstream` remote, merge the 3 commits, and do it *before*
rebranding so the branding work lands on current code. Conflict risk now is
effectively nil; after rebranding it will not be.

---

## 3. Directive 2 — unique application data directory

**Status: the highest-risk item in the phase. Two independent identity roots.**

### Root A — Electron `userData` (derives from app name)

`src/main/core/preboot/userDataLocation.ts` resolves `userData` before
`app.whenReady()`. It only calls `setPath` for three cases — dev suffix, an explicit
`app.user_data_path` BootConfig override, and portable builds. In the **normal
packaged case it does not call `setPath` at all**, so Electron's default applies,
which derives from the app name (`CherryStudio`).

Renaming the app therefore **moves `userData` implicitly**. On an existing install
that silently orphans the user's entire profile — chats, SQLite DB, Chromium storage
(Cookies, LocalStorage, IndexedDB, all of which Electron derives lazily from
`userData`).

### Root B — `CHERRY_HOME` (`~/.cherrystudio`)

`src/main/core/paths/constants.ts:21-23`:

```ts
export const CHERRY_HOME_DIRNAME = '.cherrystudio'
export const CHERRY_HOME = path.join(os.homedir(), CHERRY_HOME_DIRNAME)
export const BOOT_CONFIG_PATH = path.join(CHERRY_HOME, 'boot-config.json')
```

This is **outside `userData`** and survives relocation by design — it is where
BootConfig lives pre-lifecycle. Only **5 files** reference it, so the change is
small; the *sequencing* is the hazard, because `BOOT_CONFIG_PATH` is read during
preboot and holds the `app.user_data_path` override that Root A consults.

### Interaction risk (the part to get right)

Changing both roots at once, without a migration, means a running install loses its
BootConfig *and* its userData in the same release — including the override that would
have pointed at the old location. `v2MigrationGate.ts` and
`data/migration/v2/core/MigrationPaths.ts` already implement a relocate-and-relaunch
mechanism for the v1→v2 move; **it is the precedent to follow, not to bypass.**

**Gaps:**
- **G4.1** Decide the Boss data identity: `appId` (`tools.know-me.the-boss` per the
  1.9.x reference), app name, and home dirname (`.the-boss`?). Must be internally
  consistent.
- **G4.2** Make `userData` **explicit** rather than name-derived, so the directory
  never moves as a side effect of a display-name change.
- **G4.3** Decide migration policy: adopt an existing Cherry profile, start clean, or
  prompt. **This is a user-data-loss decision and needs an explicit answer — see
  Question 1.** Given the fork has no users yet, "start clean" may be correct and far
  cheaper, but that must be a decision, not an accident.

---

## 4. Directive 3 — menus and menu text

**Status: better than expected. Mostly already correct.**

- `src/main/services/AppMenuService.ts` already routes labels through `t()` from
  `@main/i18n` and uses `app.name` for the application menu label
  (`AppMenuService.ts:86`). **No hardcoded product strings in the menu layer.**
- Menu/tray surfaces: `AppMenuService.ts`, `TrayService.ts`, `ContextMenu.ts`,
  `nativePopupMenu.ts`, `services/menu/adapters/nativeMenuAdapter.ts`.
- Therefore menus rebrand **automatically** once (a) `app.name`/`productName` change
  and (b) the i18n catalogs are updated. No per-menu editing required.

### The real i18n number

The 4,306 raw `Cherry*` occurrences in `goals.md` badly overstate the user-visible
work. Measured against the catalogs:

| Tree | Keys containing "cherry" (structural — **leave alone**) | **Values** containing "cherry" (user-visible — **must change**) |
|---|---|---|
| renderer | 48 | **76** |
| main | 3 | **13** |
| | | **89 total** |

Locales: **13 per tree** (not 10 as `goals.md` estimated), both sourced from
`en-us.json`.

Renaming the 51 *keys* would be churn that maximizes merge-conflict surface for zero
user benefit — consistent with the existing non-goal on internal identifiers.

**Gap G3.1:** edit 89 values in the two `en-us.json` files → `pnpm i18n:sync` →
translate every `[to be translated]:` placeholder across 13 locales × 2 trees.
`pnpm lint` enforces this (rejects placeholders, empties, interpolation mismatches,
unsorted keys), so the gate is self-verifying.

**Gap G3.2:** `pnpm i18n:hardcoded:strict` exists in CI (`ci:basic-check`). Run it to
find user-visible strings that bypass i18n entirely — the menu layer is clean, but
this has not been verified tree-wide.

---

## 5. Service disconnection (G4)

15+ upstream domains. Highest-volume: `open.cherryin.net` (65),
`open.cherryin.ai` (31), `cherry-ai.com` (31), `express-ent-admin.cherryin.ai` (19),
`docs.cherry-ai.com` (17), `cloud.cherryai.com.cn` (12), plus
`releases.cherry-ai.com` and `analytics.cherry-ai.com`.

Concentration is encouraging — the top directories are mostly `__tests__`, with real
config in `src/shared/data/presets/cherryai.ts`, `src/renderer/pages/settings/`, and
`src/main/services/`. There is **no existing central endpoint module**; that is
exactly the hole G1 should fill.

Distinct categories, which should **not** be treated uniformly:

1. **Updater** — `dev-app-update.yml` currently points at `http://127.0.0.1:3378`.
   The 1.9.x reference used `https://the-boss.know-me.tools/releases/latest/download`.
2. **Docs / onboarding / support links** — user-facing, safe to repoint.
3. **Telemetry** — `analytics.cherry-ai.com` + Sentry (`main.ts:27` `initSentry`).
   Privacy-relevant; needs a deliberate disable-or-retarget decision.
4. **Outbound API attribution** — `src/main/utils/http.ts:6` sends
   `X-Title: Cherry Studio`; `openapiDocs.ts` titles the API "Cherry Studio API".
   These identify *us to third parties* and should change with the brand.
5. **Provider presets / built-in agents** — `cherry_assistant`, `cherry_support`
   built-in agents point at Cherry's own support infrastructure. Repointing these at
   nonexistent Boss infrastructure would make them **worse than removing them**.

---

## 6. Prior art — reuse, with a caveat

`/Users/gqadonis/Projects/references/baseline/cherry-studio` (v1.9.11) is a fully
rebranded fork: `productName: The Boss`, `appId: tools.know-me.the-boss`, Boss
icon/logo assets (`icon.png` and `logo.png` share hash `d2b254e0`, confirmed
different from ours), and a completed `upstream-1.9.x-merge-strategy` phase
documenting a **direct-merge** playbook (not rebase, not cherry-pick).

**Caveat:** it is v1.9.11 and predates the v2 refactor. Binary assets port cleanly;
config and service wiring likely do not. Treat config as *evidence of intent*, not
as a patch to apply.

---

## 7. Gap summary

| ID | Gap | Goal | Severity | Notes |
|---|---|---|---|---|
| G5.1 | No `upstream` remote; 3 commits behind | G5 | **High** | Do first — conflict-free today |
| G4.2 | `userData` is name-derived, not explicit | G2/G4 | **Critical** | Silent profile orphaning |
| G4.3 | No data-migration policy decision | G4 | **Critical** | User-data-loss risk |
| G1.1 | No central branding/endpoint module | G1 | **High** | Prerequisite for cheap merges |
| G4.1 | Boss identity values undecided | G1 | High | appId/name/home dirname |
| G3.1 | 89 i18n values + 13×2 locale sync | G3 | Medium | Self-verifying via `pnpm lint` |
| G2.1 | No Boss assets in `build/` | G2 | Medium | Port from 1.9.x reference |
| G4.4 | Telemetry destination undecided | G4 | Medium | Privacy-relevant |
| G4.5 | Built-in Cherry agents point at Cherry infra | G4 | Medium | Remove vs. repoint |
| G3.2 | `i18n:hardcoded:strict` not yet run | G3 | Low | Cheap to check |
| — | Hooks subsystem unavailable | — | Low | `KBD_ORCHESTRATOR_ROOT` unset |

---

## 8. Recommended sequencing for /kbd-plan

1. **G5.1 first.** Merge the 3 upstream commits *now*, while conflict surface is zero.
2. **G1 + G4.1/G4.2 next.** Central branding module; make `userData` explicit **in the
   same change** so the rename cannot move it implicitly.
3. **G2** assets, **G3** i18n — both mechanical once the indirection exists.
4. **G4** service repointing, gated on Question 3 (does Boss infrastructure exist?).
5. **G6** full-gate verification + a dry-run upstream merge to *prove* G5.

---

## 9. Open questions (blocking /kbd-plan)

1. **Data migration policy — adopt, start clean, or prompt?** The only question here
   with irreversible consequences. Does any install of this fork hold data worth
   preserving? If not, "start clean" is dramatically cheaper.
2. **Is `CHERRY_EDITION` the right carrier for branding?** It is an *edition* axis
   (`global`/`cn`) already consumed by `build` vs `build:cn`. Overloading it with a
   *fork-identity* axis conflates two concerns. My read: **a separate branding module
   is cleaner** — but this is the phase's first real design decision.
3. **Does `the-boss.know-me.tools` exist and serve v2.x artifacts?** G4 is blocked on
   real infrastructure. Repointing the updater at a dead host is worse than leaving it
   at the local placeholder.
4. **Telemetry: disable or re-target?**
5. **Built-in `cherry_assistant`/`cherry_support` agents — remove or rebrand?** They
   depend on Cherry-operated backends we will not have.

---

## 10. Correction to goals.md

`goals.md` states 10 locales and implies existing Boss branding in this fork. Both are
wrong: it is **13 locales per tree**, and the fork carries **no** Boss branding. The
4,306-occurrence figure is real but misleading as a work estimate — the user-visible
i18n surface is **89 values**. `/kbd-plan` should size from this assessment.
