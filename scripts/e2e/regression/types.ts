import type { TaskSelection } from './cases'

export const PLATFORMS = ['macos', 'windows'] as const
export const RUN_MODES = ['branch', 'tag'] as const
export const CASE_STATUSES = ['pending', 'running', 'passed', 'failed', 'blocked', 'not_applicable'] as const
export type Platform = (typeof PLATFORMS)[number]
export type RunMode = (typeof RUN_MODES)[number]
export type CaseStatus = (typeof CASE_STATUSES)[number]
export type TestProfile = 'authenticated' | 'clean'

export interface CaseResult {
  id: string
  status: CaseStatus
  summary: string
  startedAt?: string
  finishedAt?: string
  artifacts?: string[]
}

export interface RunMetadata {
  appVersion: string
  commitSha: string
  mode: RunMode
  platform: Platform
  ref: string
  runner: string
  task: TaskSelection
  artifactName?: string
  artifactSha256?: string
}

export interface CapabilityResult {
  available: boolean
  detail: string
}

export interface RegressionRun {
  schemaVersion: 2
  metadata: RunMetadata
  startedAt: string
  finishedAt?: string
  capabilities: Record<string, CapabilityResult>
  cases: Record<string, CaseResult>
  phases: Record<string, PhaseResult>
}

export type RunVerdict =
  | 'development_pass'
  | 'development_failed'
  | 'development_blocked'
  | 'release_pass'
  | 'release_failed'
  | 'release_blocked'

export interface AggregateReport {
  verdict: RunVerdict
  runs: RegressionRun[]
  missingPlatforms: Platform[]
}

export interface PhaseResult {
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked'
  errors: string[]
}
