# Legacy pre-release migration chain (frozen)

The 28-step schema chain that shipped in the `v2.0.0-alpha.*` and `v2.0.0-beta.*`
builds. It was replaced by a single regenerated initial migration in
`../sqlite-drizzle` when the v2 storage layout was consolidated (#17553), which
left every pre-release database stranded: its `__drizzle_migrations` bookkeeping
records hashes and timestamps the current chain no longer knows.

These files exist so `data/migration/v2/prerelease/` can bring such a database up
to the end of this chain before handing it to the current chain. The end state of
this chain is structurally identical to `0000_orange_jasper_sitwell.sql` — same 40
tables, same columns, types, defaults, foreign keys, indexes and check
constraints; only the physical column order of 7 tables differs, which drizzle
never depends on because every generated statement names its columns.

**Frozen — never edit, extend, or regenerate.** `drizzle-kit` does not know this
folder exists (`sqlite-drizzle.config.ts` points at `../sqlite-drizzle`), and
nothing here is applied to a database that has already reached the current chain.
Schema changes go to `../sqlite-drizzle` as new appended migrations.

**Delete this folder together with `data/migration/v2/prerelease/`** once
pre-release installs are no longer supported.

## Replay must run with foreign keys OFF

Table-recreate migrations in this chain (`CREATE __new_x` → `INSERT SELECT` →
`DROP x` → `RENAME`) fire `ON DELETE CASCADE` on the `DROP` when enforcement is
on, silently taking child rows with them — this is the defect fixed in #17569,
which shipped after every one of these files. Replaying them today without
`PRAGMA foreign_keys = OFF` set *outside* the transaction would reproduce that
data loss. `applyMigrations()` already establishes that guarantee; the replay
path reuses it rather than calling `migrate()` directly.
