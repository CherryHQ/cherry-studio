# Current Waypoint

**Phase:** rebrand-to-the-boss
**Status:** planned — 0 of 10 changes complete
**Next:** `/opsx:apply rebrand-001-sync-upstream`

## Why this change first

Merging the 3 upstream commits is **provably conflict-free right now**
(`git merge-tree --write-tree HEAD upstream/main` exits 0 with zero conflicts).
That stops being true the moment the branding module lands.

## Ordering invariant (do not reorder)

`rebrand-003-explicit-userdata` **must** land before `rebrand-004-app-identity`.
userData is name-derived today, so renaming the app before pinning the directory
silently orphans user profiles.

## Decisions in force

- **D1** Start clean — no data migration; legacy Cherry profiles untouched, not adopted
- **D2** Separate branding module, not `CHERRY_EDITION`
- **D3** Updater NOT repointed — `the-boss.know-me.tools` serves a marketing site
  but `latest-mac.yml` returns 404

## Open decisions carried into execution

- Telemetry: disable or re-target (`analytics.cherry-ai.com` + Sentry)
- Built-in `cherry_assistant` / `cherry_support`: remove or rebrand
