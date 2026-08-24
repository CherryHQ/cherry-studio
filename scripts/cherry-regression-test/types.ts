export const PLATFORMS = ['macos', 'windows'] as const
export const RUN_MODES = ['branch', 'tag'] as const
export const CASE_STATUSES = ['pending', 'running', 'passed', 'failed', 'blocked', 'not_applicable'] as const
export const TASK_IDS = [
  'startup-smoke',
  'mini-app',
  'notes',
  'custom-provider-chat',
  'custom-assistant',
  'translation',
  'quick-assistant',
  'selection-assistant',
  'knowledge-import',
  'knowledge-qa',
  'everything-mcp',
  'skill-import',
  'code-cli',
  'openclaw',
  'cherryin-chat',
  'image-generation',
  'claude-agent-runtime',
  'pi-runtime',
  'deepseek-harness-runtime',
  'agent-ppt'
] as const
export const TASK_SELECTIONS = ['all', ...TASK_IDS] as const

export type Platform = (typeof PLATFORMS)[number]
export type RunMode = (typeof RUN_MODES)[number]
export type CaseStatus = (typeof CASE_STATUSES)[number]
export type TaskId = (typeof TASK_IDS)[number]
export type TaskSelection = (typeof TASK_SELECTIONS)[number]
export type TestProfile = 'authenticated' | 'clean'

export interface RegressionCase {
  id: string
  title: string
  task: TaskId
  profile: TestProfile
  modes: RunMode[]
}

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
