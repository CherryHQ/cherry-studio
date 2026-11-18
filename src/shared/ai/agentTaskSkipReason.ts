/** Why a scheduled Agent run was skipped; stored on the run so the renderer can explain it in the user's language. */
export type AgentTaskSkipReason = 'disabled' | 'capability' | 'untrusted_path' | 'no_file' | 'session_busy'
