# Migration Diagnostic Bundle Design

**Status:** Proposed; implementation is blocked pending review

**Date:** 2026-07-18

**Target:** v1-to-v2 migration gate on `main`

**Design branch:** `codex/migration-diagnostics-bundle`

## 1. Decision summary

Cherry Studio will add a preboot-safe migration diagnostics capability that can preserve bounded migration state across crashes and let users save a diagnostic ZIP from every migration failure surface.

Two candidate bundle policies will be implemented and compared before release:

- **Scheme A — strict migration diagnostic bundle:** versioned, allowlisted structured diagnostics only.
- **Scheme B — log-assisted migration diagnostic bundle:** Scheme A plus selected logs from the current migration session after best-effort credential and path redaction.

Both candidates share the same coordinator, crash-safe journal, read-only database diagnostics, oversized-payload profiling, error surfaces, save flow, and test fixtures. Scheme B is a strict additive branch on top of Scheme A. The production build will retain only the selected policy and will not expose a policy selector or hidden setting.

The database, WAL/SHM files, journal file, exports, recovered rows, and sampled business data are never included.

## 2. Goals

- Give users a save action wherever v1-to-v2 migration can fail, including before the migration window exists and after its renderer crashes.
- Preserve enough bounded state to diagnose failures that terminate the process or make the target database unreadable.
- Distinguish corruption, schema drift, constraint failures, oversized payloads, source parse failures, path failures, and UI/process failures without exporting business records.
- Let support receive one user-saved ZIP that is practical to attach to common email services.
- Compare a privacy-first structured bundle with a richer, partially redacted log-assisted bundle using the same failure fixtures.
- Keep all migration diagnostics code removable with the temporary v2 migration system.

## 3. Non-goals

- Backing up, repairing, recovering, dumping, or uploading the user's database.
- Automatically attaching or uploading the bundle.
- Building an in-app mail client or support ticket system.
- Adding a global LoggerService redaction guarantee.
- Letting users choose diagnostic levels, SQL statements, or bundle policies.
- Diagnosing arbitrary post-migration application failures.
- Keeping both candidate policies in the final production build.

## 4. Canonical terms

The canonical terms live in [`CONTEXT.md`](../../../CONTEXT.md):

- **Migration diagnostic bundle**: a user-saved archive for diagnosing a v1-to-v2 migration failure.
- **Migration diagnostics journal**: a bounded, allowlisted, crash-safe sidecar that is independent of the database.
- **Strict migration diagnostic bundle**: structured diagnostics only; no application logs or free-form errors.
- **Log-assisted migration diagnostic bundle**: selected current-session logs after best-effort redaction; it is not anonymous and may still contain user-authored text or unknown sensitive information.

Avoid “migration backup,” “database bundle,” “safe log bundle,” and “anonymous diagnostic bundle.”

## 5. Repository constraints and comparable patterns

### 5.1 Preboot ownership

`runV2MigrationGate()` runs before `application.bootstrap()` and deliberately does not depend on lifecycle-managed services. The diagnostics coordinator must therefore be a preboot-scoped object constructed by the gate and passed explicitly to its consumers, not a registered `BaseService`.

Relevant code:

- `src/main/core/preboot/v2MigrationGate.ts`
- `src/main/data/migration/v2/window/MigrationIpcHandler.ts`
- `src/main/data/migration/v2/core/MigrationEngine.ts`

The renderer continues to use the existing migration-specific IPC channels because normal IpcApi services are not running yet. Native dialogs call the same coordinator directly.

### 5.2 Journal durability

`src/main/data/db/restore/restoreJournal.ts` already provides the repository's closest durability pattern:

- strict, versioned Zod state;
- `none` / `corrupt` / `ok` read outcomes;
- atomic temporary write, file sync, rename, and directory sync;
- preboot recovery;
- corrupt-file quarantine.

Migration diagnostics will follow this pattern but remain a separate implementation. Restore and migration diagnostics have different schemas, lifecycle, retention, and ownership, so generalizing the restore journal is not justified.

### 5.3 Killable process isolation

`worker_threads.Worker.terminate()` cannot interrupt a synchronous native `better-sqlite3` call: it waits for the native query to return. Database diagnostics therefore run in a dedicated child-process asset imported through Electron Vite's `?modulePath`. The host launches the fixed asset with the Electron executable in Node mode, sends the database path and fixed file identities over IPC only after a versioned `ready` message, and never places them in argv, environment variables, stdout, or stderr. A hard timeout sends `SIGKILL`, then keeps the database lease until the real `close` event confirms process termination and stdio drain. `close`, rather than `exit`, is also required because an asynchronous spawn failure emits `error` followed by `close` without `exit`. The child must not instantiate `LoggerService`, use `console`, or launch descendants.

The main build uses one Rollup input for `main.ts`, explicitly retains CJS output, and emits the child as a separate hashed asset. A main-only smoke build reuses the production main config, writes to a fresh temporary output directory, resolves the unique child asset reference from emitted `main.js`, and scans that referenced artifact. `better-sqlite3` remains external in that child; Zod, logger code, lifecycle services, and the main-process service graph must not enter its bundle.

### 5.4 Existing redaction is local, not global

The repository contains useful domain-specific redactors, including:

- network header, query, and structured body redaction in `MainNetworkDevtoolsService`;
- known token and private-key patterns in `OutputSanitizer`;
- sensitive environment key masking in `envRedaction.ts`;
- OAuth and MCP-specific recursive redaction;
- URL-to-origin reduction in `redactUrl.ts`.

No single implementation is safe for arbitrary application logs. Existing tests document false negatives such as short passwords, bare secrets, and database URLs. `LoggerService` writes arbitrary metadata and error stacks as supplied and adds system information to warning and error records. Scheme B therefore uses a diagnostics-specific composite pipeline at package time and never claims complete anonymization.

## 6. Architecture

### 6.1 Components

#### MigrationDiagnosticsCoordinator

- Constructed at the beginning of `runV2MigrationGate()`.
- Starts in memory-only mode so path-resolution failures can still produce a minimal bundle.
- Attaches resolved `MigrationPaths` once path resolution succeeds, then enables the persistent journal.
- Owns the current session and attempt state.
- Receives allowlisted events from the gate, engine, migrators, IPC handler, and migration window manager.
- Exposes one save operation used by renderer IPC and native dialogs.
- Does not use a service container or hidden global singleton.

#### MigrationDiagnosticsJournal

- Stores one versioned JSON snapshot rather than append-only JSONL.
- Uses the restore journal's atomic durability pattern.
- Lives at a path declared in `MigrationPaths`; migration code must not construct the path ad hoc.
- Stores no raw error, stack, SQL, business value, path, log line, or database content.
- Is never copied directly into the bundle.

#### MigrationDiagnosticBundleBuilder

- Snapshots coordinator state in memory.
- Runs database diagnostics lazily when the user requests a bundle.
- Applies the selected candidate policy.
- Validates every generated document against a strict output schema.
- Enforces the policy's uncompressed-byte budget before archiving.
- Writes a sibling `.partial` file at the user-selected destination and atomically renames it on success.
- Cleans up `.partial` output on failure.

#### MigrationDatabaseDiagnosticsChild

- Opens the target database read-only.
- Runs independent bounded diagnostic steps.
- Returns a typed result only.
- Is killed with `SIGKILL` after a hard timeout; the host waits for process close.
- Cannot prevent the rest of the bundle from being saved.

#### MigrationDbService diagnostics lease

- Owns the migration writer and database path.
- Grants full L1/L2 diagnostics only through a callback-scoped opaque lease.
- Fixes the database, WAL, and SHM device/inode identities for the child.
- Defers an idempotent `close()` until the last diagnostics callback observes child close.
- Returns unavailable instead of exposing the SQLite connection or a manual release handle.

#### MigrationLogCollector

- Exists only on the Scheme B branch.
- Reads centrally located application log files for the union of recorded attempt intervals.
- Includes migration-context `info`, `warn`, and `error` records.
- Includes only `warn` and `error` records from other modules in those intervals.
- Excludes all `debug` records and unrelated `info` records.
- Includes only parseable, expected JSON log lines.
- Applies the diagnostics-specific redaction pipeline before size selection.
- Does not modify on-disk logs or global LoggerService behavior.

### 6.2 Data flow

1. The gate creates the coordinator and begins a migration session.
2. Path resolution attaches persistent journal storage when possible.
3. Each initial run, retry, or recovered run creates an attempt with its own interval.
4. Gate, engine, migrators, and window management record allowlisted state transitions.
5. A failure surface offers the same save operation.
6. The user chooses a destination; Scheme B first requires privacy confirmation.
7. The builder snapshots structured state and asks `MigrationEngine` to collect database diagnostics. L0 always runs; L1/L2 run only inside a live `MigrationDbService` lease. Scheme B may additionally collect and redact logs.
8. The builder validates, truncates by uncompressed-byte budget, archives, and atomically publishes the ZIP.
9. The app offers external email, reveal-in-folder, and copy-address actions.
10. The journal remains available through retries and is deleted only after migration succeeds.

## 7. Session and journal model

The journal is a strict object with unknown keys rejected.

### 7.1 Session fields

- schema version;
- random session ID unrelated to any user or business identifier;
- application version;
- normalized platform and architecture;
- start time;
- current state.

### 7.2 Attempt fields

- random attempt ID;
- trigger: `initial`, `manual_retry`, or `recovered_retry`;
- start and end time;
- outcome;
- bounded event collection.

### 7.3 Event fields

- monotonic sequence number;
- timestamp;
- fixed event code;
- migration stage;
- known migrator ID, when applicable;
- phase: `prepare`, `execute`, `validate`, or a fixed gate/window/package phase;
- fixed result and error categories;
- allowlisted SQLite or Node error code;
- `failed`, `timed_out`, and `truncated` flags;
- optional bounded payload-length profile.

Unknown error strings, schema names, and objects map to `unknown`; code must not use `String(value)` as a journal fallback.

Paths use semantic labels such as `database`, `legacy-data`, `migration-export`, and `logs`, never absolute paths.

### 7.4 Persistence and retention

The coordinator writes at meaningful boundaries rather than progress ticks:

- session and attempt start;
- migrator and phase transitions;
- failure;
- attempt finish;
- migration completion.

All attempts in the unfinished session are eligible for the bundle. If the bounded journal budget is reached, the coordinator preserves the session start, every attempt's terminal event, and the newest events, dropping the oldest intermediate events first. The serialized journal must remain below the Scheme A bundle budget.

Successful migration deletes the journal immediately. Failure, process crash, force quit, or power loss leaves it for the next launch.

## 8. Failure coverage and UI surfaces

### 8.1 Renderer migration page

The error state uses `@cherrystudio/ui` and provides:

- **Save diagnostic bundle**;
- **Retry**;
- the existing safe close/quit behavior.

The save action shows a loading state and prevents duplicate concurrent builds.

### 8.2 Before the renderer exists

Fatal pre-window failures replace `dialog.showErrorBox` with native message boxes that can offer save, retry/relaunch when meaningful, and exit. This includes:

- data-location persistence failure;
- inaccessible or invalid migration paths;
- database initialization or migration-status probe failure;
- version-gate fallback failure;
- migration window creation failure.

If resolved paths are unavailable, the coordinator remains memory-only and saves a minimal bundle.

### 8.3 Renderer crash or hang

`render-process-gone` and unresponsive handling stays in the main process and offers a native save action. It cannot depend on renderer IPC.

### 8.4 Cross-launch recovery

Before starting a new migration attempt, the gate detects an unfinished journal and offers:

- save the previous session's diagnostic bundle;
- continue with a recovered retry;
- exit.

The recovered retry remains part of the same session with a new attempt ID.

### 8.5 Bundle failure semantics

- User cancellation is not an error.
- Failure of one diagnostic component is recorded in the manifest while other components continue.
- Database failure or timeout never blocks the bundle.
- ZIP construction or destination write failure shows a stable safe code and copyable summary.
- A bundle-build failure does not recursively offer another bundle button.

## 9. Read-only database diagnostics

No external `.sql` file is shipped or presented to the user. The isolated child owns a versioned set of named, read-only diagnostic steps.

### 9.1 L0: file and header

Without opening SQLite:

- existence and regular-file status;
- size bucket and modification time;
- SQLite header validity when enough bytes are available.
- the header write-version as a fixed `rollback` / `wal` / `unknown` / `unavailable` value;
- the `-wal` / `-shm` pair as a fixed sidecar-state value, using `lstat` without following symlinks.

No absolute path or raw header bytes are included.

### 9.2 WAL snapshot and mutation boundary

L1/L2 remain available for a live WAL database only while the app's migration writer grants an explicit callback lease:

- `MigrationDbService` grants the lease only while its SQLite writer is open, close has not been requested, and the database, `-wal`, and `-shm` are all regular non-symlink files;
- the lease records device/inode identities for all three files, increments an active count synchronously, and retains the writer from child spawn through normal close or hard-kill close;
- `close()` becomes an idempotent deferred close while a lease is active; the last callback's `finally` performs the pending close;
- the child checks all three identities immediately before and immediately after its read-only SQLite open. A mismatch returns fixed `identity_mismatch` L1/L2 failures without diagnostic data;
- if no safe lease is available because initialization failed, the engine is closed, close was requested, or sidecars are incomplete/unsafe, diagnostics run L0 only, never construct SQLite, and return fixed `lease_unavailable` completion;
- a valid lease opens with `readonly`, `fileMustExist`, and `query_only`, so diagnostics observe the writer's current committed WAL snapshot;
- the main database and WAL file contents, size, hash, and modification time must remain unchanged;
- SQLite may update the already-existing SHM coordination cache while serving the reader. SHM hash and modification time are therefore not invariant, and this feature does not claim forensic zero-mutation semantics.

The lease closes the app-owned writer TOCTOU: app shutdown cannot delete the sidecars between L0 and SQLite open. It does not claim to prevent a malicious external process from atomically replacing files. Device/inode mismatch is detected and L1/L2 are discarded, but defending against a hostile filesystem would require a snapshot or file-descriptor-based SQLite design outside this feature.

### 9.3 L1: structure metadata

After a read-only open:

- safe PRAGMA metadata needed to understand the file format and migration version;
- expected application schema comparison;
- known expected object status;
- counts by type for unknown objects, without unknown object names or raw schema SQL.

### 9.4 L2: bounded integrity

- `PRAGMA quick_check(20)`;
- `PRAGMA foreign_key_check`;
- raw row IDs removed;
- results mapped to fixed categories;
- known application object identifiers may be retained, while unknown identifiers map to `unknown`;
- output count and byte caps applied.

Child-produced levels report `success`, `failed`, or `truncated`. The host separately reports overall `completed`, `failed`, or `timed_out` completion and preserves only the real ordered level prefix received before a terminal process failure; it does not fabricate unfinished levels. A final message is accepted only after L0, L1, and L2 have arrived in order and all three are deeply identical to the saved prefix. After that final message and before process close, any additional IPC message—including a duplicate step, an unknown object, or an arbitrary value—is a `protocol_error`: the host sends `SIGKILL` once and retains the lease until the real close event.

### 9.5 Explicit exclusions

The diagnostic child does not execute:

- business-row `SELECT` or sampling;
- `COUNT(*)` business volume queries;
- dump or `.recover`;
- `dbpage` or raw page access;
- default full `integrity_check`;
- repair, mutation, checkpoint, vacuum, or attachment copying.

SQLite documents `quick_check` as faster than `integrity_check`, with a result-row limit rather than a time limit. The process timeout remains necessary. On expiry the host sends `SIGKILL` and does not return, close the writer, or release its WAL lease until the child emits `close` after process termination and stdio drain:

- <https://www.sqlite.org/pragma.html#pragma_integrity_check>
- <https://www.sqlite.org/fileformat.html#the_database_header>

## 10. Oversized source or payload diagnostics

Post-failure target database queries cannot diagnose a rejected row: a failed insert does not leave the offending value in the target database, and most legacy sources are exported JSON rather than SQLite.

Oversized-data coverage therefore belongs at the migration write boundary.

### 10.1 Failure-time payload profile

When a batch write fails, a diagnostics helper receives the in-memory batch and records numeric shape only:

- migrator, phase, target entity, batch index, and batch count;
- classified error, including `SQLITE_TOOBIG`, serialization-size failures, and path-length failures;
- total batch byte-length range;
- largest record byte-length range;
- allowlisted top-level field type;
- character-count and UTF-8 byte-length ranges for strings;
- byte-length range for blobs;
- serialized aggregate length and largest string-leaf range for JSON fields.

JSON nested keys and values are not recorded. Unknown objects are not stringified. Profiling is bounded by depth, field count, and time so it cannot become a second failure.

If failure occurs before records exist in memory, such as source JSON parsing, diagnostics record only the semantic source, export-file size range, and fixed parser error category.

### 10.2 Why no length-scanning SQL

- It would miss rejected rows.
- It would not cover JSON exports or Redux/local-storage sources.
- Broad scans would add cost and business-volume metadata without locating the failed batch.

Targeted failure-time profiling is both more diagnostic and more private.

## 11. Scheme A: strict migration diagnostic bundle

Scheme A contains exactly four top-level files:

| Entry | Contents |
|---|---|
| `manifest.json` | Format version, normalized app/platform data, session/attempt summary, component status, byte counts, and truncation flags |
| `migration-events.json` | Allowlisted session, attempts, fixed events, and bounded payload-length profiles |
| `database-diagnostics.json` | L0-L2 typed database results |
| `README.txt` | User-readable contents, exclusions, and support instructions |

Scheme A excludes:

- application logs;
- raw journal file;
- raw `Error.message`, stack, or cause;
- SQL statements or parameters;
- unknown stringification;
- user or account identifiers;
- business counts, values, samples, and records.

All output schemas are strict and reject unknown properties. The total uncompressed bytes of all archive entries must not exceed **1 MiB**.

## 12. Scheme B: log-assisted migration diagnostic bundle

Scheme B inherits all Scheme A entries and adds:

| Entry | Contents |
|---|---|
| `logs/app-session.jsonl` | Selected, parseable, package-time-redacted records from the current migration session |
| `redaction-summary.json` | Redaction hit counts, excluded-line counts, candidate/retained counts, and truncation flags; never original values |
| `log-selection.json` | Attempt intervals and level/module selection statistics, without raw paths |

The total uncompressed bytes of all Scheme B entries must not exceed **10 MiB**. Size is measured before ZIP compression. The generated ZIP is not inspected or trimmed according to compressed size.

### 12.1 Log selection

- Union of all attempt intervals in the unfinished session.
- Migration-context records at `info`, `warn`, and `error`.
- Other modules only at `warn` and `error`.
- No `debug`, `verbose`, or `silly` records.
- No unrelated normal `info` records.
- Unparseable or unexpected lines are excluded, never copied as raw fallback.

When the byte budget is exceeded, retain in order:

1. session boundaries;
2. every attempt's terminal failure record;
3. newest `error` records;
4. newest `warn` records;
5. newest migration-context `info` records.

The manifest records candidate and retained counts and all truncation.

### 12.2 Package-time redaction order

1. Recursively mask credential and explicit identity fields: password, token, cookie, authorization, API key, client secret, private key, email, user/account/device identifiers. Generic `id` is not automatically masked.
2. Scan remaining string leaves for Bearer tokens, PEM keys, and known OpenAI, Anthropic, GitHub, AWS, and similar credential forms.
3. Remove URL username/password and mask sensitive query parameters while retaining origin, path, and non-sensitive parameters.
4. Replace known local roots with `<USER_DATA>`, `<HOME>`, `<LOGS>`, and `<MIGRATION_EXPORT>`.
5. Remove CPU model, memory size, and other hardware fingerprint fields. Keep normalized OS, architecture, and app version only in the manifest.
6. Retain error stacks only after the same credential, URL, and path processing.

The redactor is diagnostics-local. Existing domain redactors provide patterns and test cases but are not reused as a false universal guarantee.

### 12.3 Residual risk and consent

Arbitrary natural language cannot be reliably classified as a user message without deleting the diagnostic value of logs. Scheme B may therefore retain user-authored text or unknown sensitive information.

If Scheme B is selected for production, saving requires an explicit privacy confirmation that states:

- current-session application logs are included;
- credentials and paths are redacted on a best-effort basis;
- user input or unknown sensitive information may remain;
- the database and its sidecars are never included.

Scheme A does not require this blocking confirmation.

## 13. Save, archive, and support flow

### 13.1 Save behavior

- Production: one system save dialog and one final ZIP.
- Development comparison on the Scheme B branch: one destination-directory choice produces an A ZIP and a B ZIP from the same coordinator snapshot.
- The user never sees a policy selector.
- Fixed archive entry names prevent path traversal.
- Only regular, centrally resolved log files are candidates.
- Destination files use restrictive permissions where the platform supports them.

### 13.2 After save

Do not switch applications automatically. Show three actions:

- **Open email client**: use `mailto:` for `support@cherry-ai.com` with a prefilled subject and instructions; the user manually attaches the ZIP.
- **Show in folder**: reveal the ZIP for attachment.
- **Copy support email**: fallback when no default mail client is configured.

There is no automatic upload, attachment, public GitHub issue, or in-app email draft.

### 13.3 Email-size acceptance

The bundle byte limits are based only on uncompressed archive entries. Text diagnostics normally compress below those limits, but no compressed-size guarantee is made. Release acceptance includes sending a near-limit real bundle to `support@cherry-ai.com` and confirming receipt. Provider-specific enterprise limits remain outside the application's control.

## 14. Candidate branch strategy

Use stacked implementation branches after this design is reviewed:

```text
origin/main
└─ reviewed design/common foundation
   └─ codex/migration-diagnostics-strict
      └─ codex/migration-diagnostics-log-assisted
```

- The strict branch implements the complete shared diagnostics architecture and Scheme A.
- The log-assisted branch starts from the strict branch and adds only log selection, redaction, Scheme B consent, and development dual-output comparison.
- `strict..log-assisted` therefore exposes the exact additional privacy and maintenance surface.
- If A wins, the strict branch becomes the production candidate.
- If B wins, the log-assisted branch becomes the production candidate.
- The losing policy and development dual-output path are removed before the production PR.

Two independent branches directly from `main` were rejected because they would duplicate most of the implementation and make fixes, tests, and comparison drift.

## 15. Candidate selection

Run the same seeded failure matrix against both packages and perform blind developer triage:

- database open failure and structural corruption;
- schema mismatch and constraint failures;
- oversized string, JSON, and blob payloads;
- malformed or oversized source export;
- missing or unwritable paths;
- renderer crash and unresponsive state;
- multiple retries and cross-launch recovery;
- partial database, log, or archive component failure.

Reviewers score whether a package identifies:

- the failure category;
- the responsible gate/migrator and phase;
- the next useful code location or investigation.

Scheme A wins by default if it covers every high-priority fixture. Scheme B is selected only if it materially diagnoses a real high-priority case that A cannot and passes privacy review. The final choice and rationale will be recorded in an ADR or the finalized design document.

## 16. Testing and verification

### 16.1 Unit tests

- journal schema, atomic replacement, corrupt quarantine, recovery, retention, and completion cleanup;
- state transition and concurrent-save guards;
- safe cause-chain error classification;
- payload profiler size categories and bounded traversal;
- strict output schemas rejecting unknown keys;
- uncompressed-byte accounting and truncation priority;
- Scheme B interval, module, and level selection;
- every redaction rule and documented non-guarantee.

### 16.2 Database process and lease tests

Use `setupTestDatabase()` with production migrations for components that read SQLite. Cover:

- healthy database;
- expected schema mismatch;
- foreign-key violations;
- truncated/corrupted file copy;
- unreadable file;
- per-step output truncation;
- asynchronous spawn `error` followed by `close` without `exit`, bounded `process_error`, deferred writer close, and listener cleanup;
- confirmed in-flight native query, hard `SIGKILL`, observed exit and close, and subsequent writer commit/checkpoint/integrity;
- callback lease identity capture, L0-after-close race, deferred close, and no-lease L0-only fallback;
- child input/ready/final protocol closure and complete-prefix deep consistency;
- partial step failure while the bundle still succeeds.

Do not hand-write production table DDL in tests.

### 16.3 Integration tests

- every preboot dialog route;
- renderer save IPC and loading state;
- renderer crash/unresponsive native fallback;
- unfinished-journal prompt and recovered retry;
- user cancellation;
- `.partial` cleanup and atomic publish;
- Scheme B privacy confirmation;
- mailto, reveal-in-folder, and copy-address actions;
- development A/B output from the same snapshot.

### 16.4 Privacy and archive tests

Seed canaries for:

- user messages;
- absolute home and user-data paths;
- API keys, Bearer tokens, cookies, passwords, private keys, and database URLs;
- email, account, user, and device identifiers;
- error stack paths;
- oversized secret-bearing JSON.

Extract the final archive and scan every byte. Scheme A must contain none of the canaries. Scheme B must remove canaries covered by declared rules; its tests must not claim arbitrary free-text anonymity.

Also assert:

- fixed ZIP entry allowlist;
- no database, WAL, SHM, journal, migration export, or recovered business data;
- no archive traversal;
- Scheme A at most 1 MiB uncompressed;
- Scheme B at most 10 MiB uncompressed;
- truncation is explicit and preserves required terminal events.

### 16.5 Repository verification

Each implementation branch must run:

- targeted tests during development;
- `pnpm lint`;
- `pnpm test`;
- `pnpm format`;
- `pnpm build:check`;
- migration-window interactive smoke tests.

The design-document commit also follows the repository's signed Conventional Commit and pre-commit verification requirements.

## 17. Alternatives rejected

### Package the whole database

Rejected because of privacy, size, and corruption risk. WAL/SHM and recovery output are equally excluded.

### Ship a SQL script for users or support to run

Rejected because execution environment and corruption state are uncontrolled, it cannot cover JSON sources, and it shifts a risky technical task to users. Internal named read-only diagnostics are reproducible and bounded.

### Use only existing application logs

Rejected because existing logs may contain paths, identifiers, configuration fragments, error stacks, user-authored text, or credentials. Logs also do not survive every early crash reliably.

### Globally redact LoggerService output

Rejected for this migration feature because it changes all stored logs, creates a misleading global safety claim, and expands the change far beyond migration diagnostics. Scheme B redacts only selected copies at package time.

### Let the user choose strict or detailed diagnostics

Rejected because users cannot make an informed diagnostic/privacy tradeoff during a failed migration. Candidate choice is an engineering and privacy decision made before release.

### Run full diagnostics automatically on every error

Rejected because it adds I/O and potentially expensive database access even when the user will not save a bundle. Structured journal recording is continuous; database checks and log collection are lazy on save.

## 18. Implementation gate

No implementation begins until:

1. this design is reviewed;
2. its personal Feishu copy is synchronized and verified;
3. a concrete implementation plan is written;
4. the two stacked candidate branches are created from the reviewed design base.
