/**
 * Agent-session "prepare response" timeline — the window between message send and the first
 * streamed token. Shared, runtime-agnostic shapes used by the main-process recorder, the streamed
 * progress data part, and the renderer's live label + post-hoc breakdown.
 *
 * NOTE: intentionally free of any claude-code specifics. A future runtime driver reuses the same
 * stage enum / timeline shape; stages a given driver doesn't have are simply absent.
 */

/**
 * Fine-grained prepare stages, in the order a cold turn walks them. A given turn records only the
 * stages it actually ran (a warm-query hit skips the settings sub-steps, a prime connect stops at
 * `spawn-to-init`, …), so consumers must treat any stage as optional.
 */
export type PrepareTimelineStage =
  | 'dispatch'
  | 'mcp-warm'
  | 'shell-env'
  | 'workspace'
  | 'tool-permissions'
  | 'system-prompt'
  | 'mcp-metadata'
  | 'skills'
  | 'request-setup'
  | 'warm-query'
  | 'spawn-to-init'
  | 'init-to-first-chunk'

/** Classification of a warm-query consume attempt. `miss-signature` implies a prewarm/consume drift. */
export type WarmQueryOutcome = 'hit' | 'miss-no-entry' | 'miss-signature'

/** Optional per-stage detail. Every field is a boolean / count / server NAME — never a secret. */
export interface PrepareStageDetail {
  /** `mcp-warm`: whether the bounded warm completed before its timeout, and how many servers. */
  completedInTime?: boolean
  serverCount?: number
  /** `shell-env`: whether this call was the first (uncached) login-shell fetch this app run. */
  shellEnvColdFetch?: boolean
  /** `warm-query`: why a warm subprocess was or wasn't reused. */
  warmQuery?: WarmQueryOutcome
  /** `mcp-warm`: the single MCP server's name when exactly one dominates (for the live label). */
  mcpServerName?: string
}

export interface PrepareTimelineStageEntry {
  stage: PrepareTimelineStage
  ms: number
  detail?: PrepareStageDetail
}

/** Finalized breakdown of one prepare window. `totalMs` is the observed wall-clock end minus start. */
export interface PrepareTimeline {
  totalMs: number
  stages: PrepareTimelineStageEntry[]
  /** Runtime driver type that produced this timeline (e.g. `claude-code`); shown as the agent type. */
  runtimeType?: string
  /** MCP server NAMES referenced by the turn (diagnostics only; never ids/urls/env). */
  mcpServerNames?: string[]
}

/**
 * Coarse phase for the live placeholder label — deliberately 3 buckets, not 1:1 with the stages,
 * so the user sees a stable "what is it doing" signal rather than flickering internal step names.
 */
export type PreparePhase = 'starting-runtime' | 'connecting-mcp' | 'waiting-first-response'

/**
 * The streamed data part (`data-prepare-progress`, hidden). Updated in place by a stable part id
 * while the turn prepares, then finalized with the full `timeline` when the first token arrives.
 */
export interface PrepareProgressPartData {
  phase: PreparePhase
  /** MCP server name to surface in the "connecting MCP servers" label when one dominates. */
  mcpServerName?: string
  /** Full breakdown; present only once finalized (first content chunk / prime init). */
  timeline?: PrepareTimeline
}

/** Stable part id — data parts with the same id reconcile in place in the AI SDK stream reader. */
export const PREPARE_PROGRESS_PART_ID = 'cs-prepare-progress'

/** Below this elapsed time the placeholder stays generic ("Preparing response") — no stage label. */
export const PREPARE_PROGRESS_LABEL_MIN_ELAPSED_MS = 3_000

/** The footer breakdown appears only when a finalized timeline exceeds this total. */
export const PREPARE_TIMELINE_FOOTER_THRESHOLD_MS = 5_000

const STARTING_RUNTIME_STAGES: ReadonlySet<PrepareTimelineStage> = new Set([
  'dispatch',
  'shell-env',
  'workspace',
  'tool-permissions',
  'system-prompt',
  'mcp-metadata',
  'skills',
  'request-setup',
  'warm-query',
  'spawn-to-init'
])

/** Map a fine stage to its coarse live phase. */
export function stageToPhase(stage: PrepareTimelineStage): PreparePhase {
  if (stage === 'mcp-warm') return 'connecting-mcp'
  if (stage === 'init-to-first-chunk') return 'waiting-first-response'
  if (STARTING_RUNTIME_STAGES.has(stage)) return 'starting-runtime'
  return 'starting-runtime'
}

/**
 * Copyable diagnostics — deliberately restricted to non-sensitive timings, counts, app version,
 * and agent type. User-controlled labels (including MCP server names) remain live-UI-only.
 */
export interface PrepareDiagnostics {
  totalMs: number
  stages: PrepareTimelineStageEntry[]
  appVersion: string
  agentType: string
}

export function buildPrepareDiagnostics(input: {
  timeline: PrepareTimeline
  appVersion: string
  agentType?: string
}): PrepareDiagnostics {
  const { timeline, appVersion } = input
  return {
    totalMs: timeline.totalMs,
    stages: timeline.stages.map((entry) => {
      const detail = { ...entry.detail }
      delete detail.mcpServerName
      return {
        stage: entry.stage,
        ms: entry.ms,
        ...(Object.keys(detail).length > 0 ? { detail } : {})
      }
    }),
    appVersion,
    agentType: input.agentType ?? timeline.runtimeType ?? 'unknown'
  }
}
