# Migration Diagnostics Strict Follow-up Design

**Status:** Approved for implementation

**Date:** 2026-07-20

**Target:** `codex/migration-diagnostics-strict`

## 1. Context

The strict migration diagnostics candidate is the selected production policy, but review found several gaps. This
follow-up deliberately fixes only small, diagnostics-introduced issues with clear production value. Pre-existing
migration IPC authorization debt and Scheme B runtime behavior remain outside this change.

## 2. Scope

### 2.1 Complete diagnostics when migration is skipped

`MigrationEngine.skipMigration()` already persists the completed migration status. After that write succeeds, it must
finish the active diagnostic attempt as completed and delete the completed journal, using the same ordering and
best-effort diagnostic helpers as the normal successful migration path:

1. persist the completed migration status;
2. finish the active attempt with fixed `gate` / `finalize` metadata;
3. clean up the journal only when the terminal event was recorded successfully.

The status write remains authoritative. A diagnostic sink failure must not turn a successful skip into a migration
failure.

### 2.2 Show a stable, copyable renderer save-failure summary

The fixed public diagnostic save codes must be a shared, immutable mapping consumed by both Main's native dialog and
the migration renderer. A renderer save failure shows the localized safe message and the matching public code as
selectable text. It does not expose raw exceptions, add a clipboard IPC channel, or add another dialog.

### 2.3 Record the production decision accurately on the strict branch

The existing migration diagnostic design document on the strict branch must record Scheme A as the production
candidate and Scheme B as comparison evidence only. The document must distinguish verified repository behavior from
unsupported comparison claims: the automated A/B scorer used only the byte-identical structured entries and therefore
did not measure diagnostic value unique to Scheme B logs. Scheme A remains selected because it covers every scored
high-priority fixture under the pre-agreed privacy-first rule.

The document must keep the live packaged migration-window smoke test and configured email-client send/receipt check
open.

## 3. Non-goals

- Retrofitting sender validation or path ownership across the pre-existing migration IPC surface.
- Adding native post-save email, reveal, or copy-address actions.
- Reclassifying renderer export I/O failures.
- Adding payload batch index/count fields.
- Changing Scheme B collection, redaction, policy selection, or A/B scoring code.
- Rebasing the candidate onto `origin/main` or preparing the production pull request.

## 4. Verification

- A focused `MigrationEngine` test proves skip ordering: completed status, completed terminal event, then journal cleanup.
- A focused renderer test proves every save failure renders its stable public code with a safe localized message and no
  raw error input.
- Native dialog tests continue to prove that the same shared public codes are used without exposing raw errors.
- Run the closest Main, shared, and renderer tests after each TDD cycle.
- Before completion, run the repository-required `pnpm lint`, `pnpm test`, `pnpm format`, and `pnpm build:check` commands.

## 5. Alternatives considered

The next larger option would also add the three native post-save support actions. It is deferred because it requires a
new native interaction loop and support-action ownership across Main call sites. The broad alignment option would also
change renderer error classification, payload profiling, and Scheme B comparison behavior; those changes cross
multiple contracts and are intentionally separated from this surgical follow-up.
