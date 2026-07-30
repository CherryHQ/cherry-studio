**THIS DIRECTORY IS NOT FOR RUNTIME USE**

**Migration files are append-only**
The chain was consolidated into a single initial migration and shipped with `v2.0.0-rc.1`, so it now runs against databases holding real user data. Never reinitialize, rewrite, or renumber a migration that has shipped, and never advise deleting `Data/cherrystudio.sqlite` — schema changes go in as new appended migrations.

- Using `better-sqlite3` as the `sqlite3` driver, and `drizzle` as the ORM and database migration tool
- Table schemas are defined in `src\main\data\db\schemas`
- `migrations/sqlite-drizzle` contains auto-generated migration data. Please **DO NOT** modify it.
- If table structure changes, we should run migrations.
- To generate migrations, use the command `yarn run db:migrations:generate`
