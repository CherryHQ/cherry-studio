export const PLATFORMS = ['macos', 'windows'] as const
export const RUN_MODES = ['branch', 'tag'] as const
export const CASE_STATUSES = ['pending', 'running', 'passed', 'failed', 'blocked', 'not_applicable'] as const
export const EVIDENCE_KINDS = ['file', 'process', 'restart', 'screenshot', 'ui'] as const

export type Platform = (typeof PLATFORMS)[number]
export type RunMode = (typeof RUN_MODES)[number]
export type CaseStatus = (typeof CASE_STATUSES)[number]
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
export type SuiteId = `suite-${1 | 2 | 3 | 4 | 5 | 6}`
export type TestProfile = 'authenticated' | 'clean'

export interface EvidenceRequirement {
  id: string
  kind: EvidenceKind
  description: string
}

export interface RegressionCase {
  id: string
  title: string
  suite: SuiteId
  profile: TestProfile
  modes: RunMode[]
  requiredCapabilities?: string[]
  steps: string[]
  acceptance: string[]
  evidence: EvidenceRequirement[]
}

export interface EvidenceRecord {
  id: string
  kind: EvidenceKind
  observedAt: string
  passed: boolean
  source: 'driver'
  summary: string
  artifactPath?: string
  details?: unknown
}

export interface CaseResult {
  id: string
  status: CaseStatus
  summary: string
  startedAt?: string
  finishedAt?: string
  evidence: EvidenceRecord[]
}

export interface RunMetadata {
  appVersion: string
  commitSha: string
  mode: RunMode
  platform: Platform
  ref: string
  runner: string
  artifactName?: string
  artifactSha256?: string
}

export interface CapabilityResult {
  available: boolean
  detail: string
}

export interface RegressionRun {
  schemaVersion: 1
  metadata: RunMetadata
  startedAt: string
  finishedAt?: string
  capabilities: Record<string, CapabilityResult>
  cases: Record<string, CaseResult>
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
