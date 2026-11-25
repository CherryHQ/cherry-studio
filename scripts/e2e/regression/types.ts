export const PLATFORMS = ['macos', 'windows'] as const
export const RUN_MODES = ['branch', 'tag'] as const
export const CASE_STATUSES = ['pending', 'running', 'passed', 'failed', 'blocked', 'not_applicable'] as const
export type Platform = (typeof PLATFORMS)[number]
export type RunMode = (typeof RUN_MODES)[number]
export type CaseStatus = (typeof CASE_STATUSES)[number]
export type TestProfile = 'authenticated' | 'clean' | 'translation-history'

export interface CaseResult {
  id: string
  status: CaseStatus
  summary: string
  startedAt?: string
  finishedAt?: string
  artifacts?: string[]
  dataSources?: string[]
}

export interface RunMetadata {
  appVersion: string
  commitSha: string
  mode: RunMode
  platform: Platform
  ref: string
  runner: string
  task: string
  artifactName?: string
  artifactSha256?: string
  providerMode?: 'mock'
  mockVersion?: string
}

export interface CapabilityResult {
  available: boolean
  detail: string
}

export interface RunSelection {
  /** Case ids this Playwright execution registered in its own suite, in suite order. */
  ids: string[]
  /** When the executing run recorded this set (ISO 8601). */
  recordedAt: string
}

export interface RegressionRun {
  schemaVersion: 2
  metadata: RunMetadata
  startedAt: string
  finishedAt?: string
  capabilities: Record<string, CapabilityResult>
  cases: Record<string, CaseResult>
  phases: Record<string, PhaseResult>
  /**
   * Per-phase case ids the executing Playwright run actually collected. A single `--grep` rerun is
   * judged against this record instead of a separate `--list` taken before/after it, so the set that
   * ran and the set that is checked come from the same execution.
   */
  selections?: Record<string, RunSelection>
}

export type RunVerdict = 'mock_pass' | 'mock_failed' | 'mock_blocked' | 'mock_not_applicable'

export interface AggregateReport {
  verdict: RunVerdict
  runs: RegressionRun[]
  missingPlatforms: Platform[]
  errors: string[]
}

export interface PhaseResult {
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked'
  errors: string[]
}
