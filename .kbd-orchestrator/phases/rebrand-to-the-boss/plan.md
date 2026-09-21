# Plan — rebrand-to-the-boss

**Phase:** rebrand-to-the-boss
**Date:** 2026-09-21
**Backend:** OpenSpec (`openspec/` present; `/opsx:*` commands)
**Source assessment:** [assessment.md](./assessment.md)
**Analyze stage:** skipped (no `library-candidates.json`) — this is config/asset work, no library adoption decisions
**Evolver:** not an evolver cycle

---

## Decisions taken at plan time

| # | Decision | Rationale |
|---|---|---|
| D1 | **Start clean — no data migration** | Fork has zero fork-only product code and no known installs. Existing Cherry profiles are left untouched on disk, not adopted, and remain recoverable by hand. Avoids reusing the v1→v2 relocate-and-relaunch machinery for a population that may be empty. |
| D2 | **Separate branding module**, not `CHERRY_EDITION` | `CHERRY_EDITION` is an *edition* axis (`global`/`cn`) already consumed by `build`/`build:cn`. Fork identity is an orthogonal axis. A fork-owned module concentrates merge conflicts into files upstream never touches — which is the whole point of G1/G5. |
| D3 | **Do NOT repoint the updater yet** | Verified empirically: `the-boss.know-me.tools` serves a live marketing site ("The Boss — Agent Studio", HTTP 200) but `latest-mac.yml` returns **404**. The update feed does not exist. Repointing the updater at a host with no artifacts is worse than the current local placeholder. Deferred to a follow-on phase. |

---

## Ordered change list

| # | Change ID | Depends on | Risk | Why this position |
|---|---|---|---|---|
| 1 | `rebrand-001-sync-upstream` | — | low | Conflict surface is zero **today**; it will not be after change 2 |
| 2 | `rebrand-002-branding-module` | 001 | med | The substrate every later change reads from |
| 3 | `rebrand-003-explicit-userdata` | 002 | **high** | Must land *with or before* the rename, never after |
| 4 | `rebrand-004-app-identity` | 003 | med | The rename itself — safe only once 003 pins the data dir |
| 5 | `rebrand-005-visual-assets` | 004 | low | Mechanical once identity is settled |
| 6 | `rebrand-006-i18n-strings` | 004 | med | 89 values + 13 locales × 2 trees; self-verifying via `pnpm lint` |
| 7 | `rebrand-007-outbound-attribution` | 002 | low | How we identify to third parties |
| 7.5 | `rebrand-0075-preboot-identity` | 002, 004 | low | **Added by adversarial vet** — OS-level identity i18n can't reach |
| 8 | `rebrand-008-service-endpoints` | 002 | med | Docs/onboarding only; updater and telemetry excluded by D3 |
| 9 | `rebrand-009-upstream-merge-discipline` | all | low | Proves G5 by dry-running a real merge |

**Adversarial vet outcome:** one CRITICAL-adjacent gap found and folded in —
hardcoded `'CherryStudio'` literals in preboot/observability that no change covered
(new 0075, plus `pathRegistry.ts:56` moved into 003). Change 001's conflict-free
claim was **verified empirically**: `git merge-tree --write-tree HEAD upstream/main`
exits 0 with zero conflicts. Re-vet after revision found no further CRITICAL issues.

---

### rebrand-001 — Sync to current upstream

**Goal:** G5 · **Agent:** claude-code · **Risk:** low

Add the permanent `upstream` remote and merge the 3 commits we lack
(`c3eda0c2b2`, `50b500df54`, `38beb6050c`). Merge base is `9e2a8d4923`.

Direct merge, not rebase — matching the playbook proven in the 1.9.x reference fork.

**Why first:** our 4 fork-only commits are all agent tooling; no product code
overlaps upstream. Conflict probability is effectively zero right now, and rises
permanently the moment change 2 lands.

**Acceptance:**
- `git remote get-url upstream` resolves to `CherryHQ/cherry-studio`
- `git rev-list --count upstream/main..HEAD` shows only fork commits; `HEAD..upstream/main` is **0**
- `pnpm lint` and `pnpm test` pass

---

### rebrand-002 — Branding module (G1 substrate)

**Goal:** G1 · **Agent:** claude-code · **Risk:** medium

Create `src/shared/branding/` as the single fork-owned source of truth: product
name, appId, home dirname, user-facing URLs, asset paths. Export typed constants;
no logic.

Per repo convention `src/shared/` is for cross-process, no-mutable-runtime-state
values — branding constants fit exactly. Add a barrel only if lint can seal deep
imports, else no barrel (Naming Conventions §6.4).

**Scope discipline:** this change *creates* the module and migrates only
`CHERRY_HOME_DIRNAME` and the `X-Title`/`HTTP-Referer` pair as proof of concept. It
does **not** sweep all 4,306 occurrences — later changes pull from it as they touch
their own surfaces.

**Acceptance:**
- Module exists with no imports from `@main/*` or `@renderer/*`
- `pnpm lint` passes (typecheck + i18n + format)
- At least two call sites read from it rather than a literal

---

### rebrand-003 — Make userData explicit ⚠ CRITICAL

**Goal:** G4 · **Agent:** claude-code · **Risk:** high

`src/main/core/preboot/userDataLocation.ts` currently calls `setPath` only for dev,
BootConfig-override, and portable builds. **A normal packaged run falls through all
three branches**, so Electron's name-derived default applies — verified by reading
the control flow. Renaming the app would therefore move `userData` as a silent side
effect, orphaning chats, the SQLite DB, and all Chromium storage.

Add an explicit `setPath('userData', …)` for the packaged non-portable case, sourced
from the branding module, so the data directory is **pinned by configuration rather
than derived from a display name**.

Per **D1 (start clean)**: no migration, no adoption of existing Cherry profiles. Log
loudly at first run when a legacy Cherry directory is detected but deliberately not
adopted, so the behavior is discoverable rather than mysterious.

**Also:** change `CHERRY_HOME_DIRNAME` (`.cherrystudio` → Boss equivalent) via the
branding module. Only 5 files reference it, but `BOOT_CONFIG_PATH` derives from it
and is read during preboot — sequence within this single change so BootConfig and
userData never disagree.

**Also — found during adversarial vet:** `pathRegistry.ts:56` builds the temp
directory as `path.join(sysTemp, 'CherryStudio')` from a **hardcoded literal**. This
is filesystem identity, not a cosmetic string, so it belongs here rather than in the
i18n change. Route it through the branding module in this change.

**Acceptance:**
- Packaged non-portable run calls `setPath('userData', …)` explicitly
- Dev, portable, and BootConfig-override paths unchanged (regression-tested)
- Temp dir derives from the branding module, not a literal
- `pnpm test:main` passes, including preboot tests
- Manual: launch, create data, relaunch → same directory, data intact

---

### rebrand-004 — App identity

**Goal:** G2 · **Agent:** claude-code · **Risk:** medium

`electron-builder.yml`: `appId: com.kangfenmao.CherryStudio` → `tools.know-me.the-boss`,
`productName: Cherry Studio` → `The Boss` (values from the 1.9.x reference fork).
Update `package.json` name if it feeds Electron's app name.

**Ordering is the whole point:** safe only *after* 003, because 003 is what stops the
rename from moving the data directory.

**Acceptance:**
- `pnpm build:unpack` produces an app named "The Boss"
- Data directory is the one pinned in 003 — **unchanged by the rename**
- App menu shows "The Boss" (inherits automatically via `app.name`)

---

### rebrand-005 — Visual assets

**Goal:** G2 · **Agent:** claude-code · **Risk:** low

Port from `references/baseline/cherry-studio/build/`: `icon.{png,icns,ico}`,
`logo.png`, `logo-lockup.png`, `tray_icon{,_dark,_light}.png`, and `icons/`
(9 sizes, 16→1024). Verified these differ from ours (`icon.png`/`logo.png` share
hash `d2b254e0`).

Binary assets port cleanly across the 1.9→2.x gap; config does not, which is why
only assets come from the reference here.

**Acceptance:**
- All sizes present and non-empty; tray icon legible in **both** light and dark
- `pnpm build:unpack` embeds the new icon

---

### rebrand-006 — i18n strings

**Goal:** G3 · **Agent:** claude-code · **Risk:** medium

Edit **89 user-visible values** — 76 in `src/renderer/i18n/locales/en-us.json`,
13 in `src/main/i18n/locales/en-us.json` — then `pnpm i18n:sync` and translate every
`[to be translated]:` placeholder across **13 locales × 2 trees**.

**Do not rename the 51 structural keys** containing "cherry" (e.g.
`agent.builtin.cherry_assistant.description`). That is churn maximizing merge
conflicts for zero user benefit — consistent with the phase non-goal on internal
identifiers.

**Known follow-on:** 65 test files assert the Cherry brand. Update those whose
assertions are genuinely about product identity. Per CLAUDE.md, delete
behavior-pinning tests encountered in files already being edited rather than
mechanically re-greening them.

**Open item carried forward:** built-in `cherry_assistant` / `cherry_support` agents
depend on Cherry-operated backends we will not have. Decide **remove vs. rebrand** —
rebranding them while pointing at dead infrastructure is worse than removing them.

**Acceptance:**
- `pnpm lint` passes (rejects placeholders, empties, interpolation mismatches, unsorted keys)
- `pnpm i18n:hardcoded:strict` passes
- No "Cherry" in user-visible UI; structural keys untouched

---

### rebrand-007 — Outbound attribution

**Goal:** G4 · **Agent:** claude-code · **Risk:** low

`src/main/utils/http.ts:5-6` sends `HTTP-Referer: https://cherry-ai.com` and
`X-Title: Cherry Studio` to every provider. `openapiDocs.ts` titles the API
"Cherry Studio API". These identify **us to third parties** and must change with the
brand. Source from the branding module.

**Acceptance:** `pnpm test:main` passes; attribution tests updated to Boss values.

---

### rebrand-0075 — Preboot & OS-level identity (added by adversarial vet)

**Goal:** G2/G4 · **Agent:** claude-code · **Risk:** low
**Depends on:** 002 (branding module), 004 (identity values settled)

The adversarial vet found hardcoded `'CherryStudio'` literals in preboot and
observability that **no other change in this plan covered**. These are OS-level and
third-party identity, not UI strings, so i18n (006) would never reach them:

- `src/main/core/preboot/crashTelemetry.ts:40-41` — `companyName: 'CherryHQ'`,
  `productName: 'CherryStudio'` passed to `crashReporter.start()`. Determines how
  crash dumps are grouped on disk.
- `src/main/core/preboot/chromiumFlags.ts:48-49` — Chromium `class` and `name`
  switches. On Linux these set the **window-manager class**, which drives taskbar
  grouping and icon matching; leaving them stale means the Boss app shows Cherry
  identity to the desktop environment.
- `src/main/ai/observability/constants.ts:1` and
  `runtime/NodeTraceService.ts:7` — `TRACER_NAME = 'CherryStudio'` in emitted traces.

(`pathRegistry.ts:56` is also a hardcoded literal but is filesystem identity, so it
moved into change **003** instead.)

**Re-vet widened this change.** A second pass found the literal in **15 non-test
files** under `src/main`, not the 4 first identified. The remainder are identity
presented to external systems and to the OS:

- `ai/mcp/oauth/provider.ts`, `services/tokenDanceOAuth.ts` — **OAuth client name**
  shown on third-party consent screens
- `ai/mcp/McpRuntimeService.ts`, `ai/channels/ChannelMessageHandler.ts`,
  `ai/skills/skillRemoteSource.ts` — client identity sent to MCP/skill endpoints
- `services/TrayService.ts` — tray tooltip
- `services/LegacyBackupManager.ts` — backup naming (**check for filesystem
  coupling before changing**; if it names on-disk artifacts, treat it like 003)
- `services/userDataRelocation/window.ts` — relocation UI text

Enumerate with:
`grep -rn "'CherryStudio'\|'Cherry Studio'" src/main --include='*.ts' | grep -v __tests__`

**Acceptance:**
- No non-test hardcoded product literal remains in `src/main` **except** those
  deliberately owned by 003 (filesystem) and 007 (outbound attribution)
- OAuth client name shows the Boss identity on a real consent screen
- Linux: window class matches the new identity
- `LegacyBackupManager` audited for filesystem coupling; if found, deferred to 003
- `pnpm test:main` passes

---

### rebrand-008 — Service endpoints (docs & onboarding only)

**Goal:** G4 · **Agent:** claude-code · **Risk:** medium

Repoint user-facing docs, onboarding, and support links to Boss-owned destinations
via the branding module.

**Explicitly out of scope per D3:**
- **Updater** — `the-boss.know-me.tools` has no `latest-mac.yml` (404). Leave the
  placeholder; do not point at a feed that does not exist.
- **Telemetry** — `analytics.cherry-ai.com` + Sentry. Still an open decision
  (disable vs. re-target). Not guessed here.

**Acceptance:** no user-facing link resolves to a Cherry-operated host; updater and
telemetry demonstrably untouched.

---

### rebrand-009 — Upstream merge discipline

**Goal:** G5/G6 · **Agent:** claude-code · **Risk:** low

Document the direct-merge playbook adapted from the 1.9.x reference, then **prove it**:
dry-run a merge of current upstream `main` and record the actual conflict set.

**Acceptance:**
- `docs/` note covering remote setup, merge (not rebase), and the branding-module conflict boundary
- A real dry-run recorded, with conflicts enumerated
- `pnpm build:check` green
- Manual: app launches with Boss identity; no runtime call to a Cherry-operated host

---

## Verification strategy

Per-change acceptance above. Phase-level gate: `pnpm build:check` (lint + docs + full
test). Note `pnpm test <path>` is forbidden — use the per-project wrappers.

## Risk register

| Risk | Mitigation |
|---|---|
| Rename orphans user data | 003 lands before 004; explicit `setPath` |
| BootConfig/userData disagree mid-flight | Both changed inside 003, sequenced |
| 65 brand-asserting tests break | Expected; addressed in 006 with the no-behavior-pinning rule |
| Updater points at dead feed | D3 defers it entirely |
| Upstream conflicts accumulate | 001 first; 009 proves the discipline |
| Built-in agents point at dead infra | Flagged in 006 as an explicit decision, not a default |
