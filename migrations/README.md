**THIS DIRECTORY IS NOT FOR RUNTIME USE**

**v2 Data Refactoring Notice**
Before the official release of the alpha version, the database structure may change at any time. To maintain simplicity, the database migration files will be periodically reinitialized, which may cause the application to fail. If this occurs, please delete the `cherrystudio.sqlite` file located in the user data directory.

- Using `libsql` as the `sqlite3` driver, and `drizzle` as the ORM and database migration tool
- Table schemas are defined in `src\main\data\db\schemas`
- `migrations/sqlite-drizzle` contains auto-generated migration data. Please **DO NOT** modify it.
- If table structure changes, we should run migrations.
- To generate migrations, use the command `yarn run db:migrations:generate`
