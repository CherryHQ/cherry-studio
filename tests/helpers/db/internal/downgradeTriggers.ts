import type { Database } from 'better-sqlite3'

// Historical fixtures predate these columns; full applyMigrations reinstalls the triggers.
// Future rebuilds of agent_session or job_schedule must account for the cross-table trigger.
export function dropDowngradeCompatibilityTriggers(sqlite: Database): void {
  for (const name of [
    'agent_session_compat_insert',
    'agent_session_compat_canonical',
    'agent_session_compat_legacy',
    'job_schedule_compat_delete'
  ]) {
    sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`)
  }
}
