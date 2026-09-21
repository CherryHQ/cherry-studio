# Reflection — rebrand-to-the-boss

**Phase:** rebrand-to-the-boss
**Date:** 2026-09-21
**Changes:** 10 / 10 complete
**Commits:** 24 (`9e2a8d4923..22d34893da`)
**Backend:** OpenSpec

---

## 1. Goal achievement — 6/6 MET

Verified against the code, not the change records.

| Goal | Status | Evidence |
|---|---|---|
| **G1** Branding indirection layer | **MET** | `src/shared/utils/branding.ts` — 14 exports, **45 consumers** |
| **G2** Visual identity ported | **MET** | `appId: tools.know-me.the-boss`, `productName: The Boss`; 9 vector-derived icon sizes; valid `.icns`/`.ico` |
| **G3** i18n rebranded | **MET** | **0** product references across 26 catalogs; `i18n:check` 76,011 translations |
| **G4** Services severed | **MET (scoped)** | User-facing links fork-owned; updater deferred per D3; Cherry-operated services deliberately retained |
| **G5** Upstream consumable | **MET (proved)** | Dry-run: **only `package.json` conflicts** vs upstream +7 |
| **G6** Gate verification | **MET** | lint ✅ · main 16,383 ✅ · renderer 12,138 ✅ · ui 792 ✅ · docs ✅ |

### G5 is the one that matters

The phase's premise was that a branding indirection layer keeps upstream cheap.
That was testable, and it was tested:

```
git merge-tree --write-tree HEAD upstream/main    # upstream 7 commits ahead
→ CONFLICT: package.json only
```

`electron-builder.yml` and **all 26 locale files auto-merged** despite carrying 828
rebranded values. The single conflict is two predictable fields (`name` ours,
`version` theirs). G1 paid for itself measurably.

---

## 2. Artifact Quality Summary

No `.refiner/` logs exist — artifact-refiner QA did not run in this phase, so
pass-rate metrics are unavailable. Quality was instead enforced by the repo's own
gates, run per change:

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 (4 typecheck projects, 76,011 translations) |
| `pnpm test:main` | 16,383 passed |
| `pnpm test:renderer` | 12,138 passed |
| `pnpm test:pkg:ui` | 792 passed |
| `pnpm docs:check` | exit 0 |

### Recurring pattern: rebranding detection inputs

The one defect class that recurred — **three times** — was rebranding a *historical
value used for detection*:

1. `LegacyBackupManager.ACCEPTED_BACKUP_APP_NAMES` — would have made every
   pre-rebrand backup **unrestorable**. Caught by audit before shipping.
2. `builtinMcpServerSeeder.isLegacyMcpAutoInstall()` — legacy rows stopped matching
   and would never migrate. **Caught by its test.**
3. `userDataLocation.LEGACY_UPSTREAM_DIRNAME` — caught during design.

Rule now documented in `docs/contrib/upstream-merges.md`:
**a historical value used for detection is input, not identity.**

---

## 3. Course corrections during the phase

Three assumptions were wrong and were corrected by evidence rather than carried:

- **Assessment premise.** `goals.md` assumed existing Boss branding and 10 locales.
  The fork was branding-virgin with **13** locales, and the 4,306-occurrence figure
  was misleading — the real user-visible surface was **89 values**.
- **Asset source.** The first icon port used degraded rasters from `build/`. The
  reference actually contained `docs/branding/` — 16 vector icons, wordmarks,
  lockups, and a **Brand Guide v2.2** with exact dual-mode palettes and verified
  contrast ratios. Everything was regenerated from vectors.
- **Ember calibration.** I initially picked one ember for both themes. The guide
  specifies **`#E04E28` light / `#FF6A3D` dark**, calibrated per background, and
  warns explicitly against reusing one for the other.

---

## 4. Technical debt introduced

| Item | Severity | Note |
|---|---|---|
| Updater still on `releases.cherry-ai.com` | **High** | D3: `the-boss.know-me.tools` is a catch-all SPA; `latest-mac.yml` 404s. Blocked on real infrastructure. |
| Telemetry destination undecided | Medium | `analytics.cherry-ai.com` + Sentry untouched. Privacy-relevant; needs a deliberate call. |
| `cherry-text-logo.svg` | Medium | A "Cherry" wordmark still rendered in MCP settings. No Boss equivalent exists in the reference — needs new artwork, not a port. |
| Brand fonts not vendored | Medium | Space Grotesk / Inter / Roboto / JetBrains Mono are declared with fallbacks but not bundled, so they render as Ubuntu today. |
| macOS builds unsigned in CI | Medium | No `CSC_LINK` secret; Gatekeeper warns. Workflow auto-enables signing when secrets appear. |
| `cherrystudio://` protocol scheme | Low | Deliberate — it is an OAuth redirect URI across 17 files. Own change, own testing. |
| `sync-registry-data.yml` unguarded | Low | Upstream workflow with no `CherryHQ` guard; pushes a branch in our repo. Noise. |
| Two `app-builder-lib` patches | Low | Upstream bugs; worth filing upstream so the patch can eventually drop. |

---

## 5. Lessons

1. **Test the infrastructure before writing config against it.** `the-boss.know-me.tools`
   returns HTTP 200 for *every* path — a catch-all SPA. Pointing docs there would
   have replaced working help with marketing copy. One `curl` on a nonsense path
   settled it.
2. **Close-out verification is not ceremony.** `rebrand-007` was already believed
   complete; verifying it surfaced `DOC_TAGS.cherry`, which becomes a **module name
   in every generated API client**.
3. **Behavior-pinning tests hide bugs.** Five tests asserted `setPath` was *not*
   called — encoding the data-loss bug as expected behavior. Mutation-checking the
   replacements (revert the fix, confirm 7 failures) proved the new ones have teeth.
4. **Two layers can hide the same bug.** Fixing the mangled cert hash in
   `parseIdentity` was not enough: `macPackager` logged the correct hash and then
   passed only the *name*. The first fix made the second visible.
5. **Prior art beats invention.** The reference fork carried a brand guide, a
   rebrand design spec, and a merge playbook. Finding them late cost rework.

---

## 6. Recommended next phase

**`boss-release-infrastructure`** — the highest-value remaining work, and what
unblocks the most debt above.

- Stand up a real release feed so the updater can leave `releases.cherry-ai.com`
  (closes the phase's only High-severity item)
- Add `CSC_LINK` / `APPLE_ID` secrets so CI ships signed, notarized macOS builds
- Decide telemetry: disable or re-target
- Vendor the four brand fonts so typography renders as designed
- Commission a Boss wordmark to retire `cherry-text-logo.svg`

Deferred alternative: `cherrystudio://` → `theboss://`, which needs OAuth
re-registration and coordination with the in-flight `#15353` work.
