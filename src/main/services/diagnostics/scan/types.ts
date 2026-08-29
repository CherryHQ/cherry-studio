/**
 * Mechanical log-error scanning: closed domain set, declarative rules, aggregated findings.
 *
 * Matching semantics (single source of truth, enforced by `engine.ts`):
 *  1. `levels` gate — record level must be listed (default: both `warn` and `error`).
 *  2. `modules` gate — applied only when the record carries a `module` field: it must equal
 *     an entry or start with `<entry>:`. Records without `module` (pre-fix log format) skip
 *     this gate and fall through to the anchors, so rules degrade instead of going blind.
 *  3. `anchors` — every regex must match the haystack (`message\nstack\ndetail`). Express OR
 *     inside a single regex with `|`.
 *  4. `exclude` — any match vetoes the rule.
 * Multiple rules may match the same record; each aggregates independently.
 */

export const DIAGNOSTIC_DOMAINS = ['provider', 'network', 'agent', 'mcp', 'chat', 'environment'] as const
export type DiagnosticDomain = (typeof DIAGNOSTIC_DOMAINS)[number]

/**
 * Who can act on a finding: `user-fixable` ships remediation guidance, `app-bug` should be
 * reported back to us, `transient` is expected to clear itself (retry / wait).
 */
export type ScanAttribution = 'user-fixable' | 'app-bug' | 'transient'

export type ScanLevel = 'error' | 'warn'

/** One parsed line from an `app-error.*.log` file (or any adapter-provided error record). */
export interface LogRecord {
  readonly timestampMs: number
  readonly level: ScanLevel
  readonly message: string
  readonly module?: string
  readonly process?: 'main' | 'renderer'
  readonly window?: string
  readonly stack?: string
  /** Serialized remainder of the line (context, data, merged caller fields), truncated. */
  readonly detail?: string
  readonly source?: { readonly file: string; readonly line: number }
}

/** Outcome of reading one time range of `app-error.*.log` files. */
export interface ErrorLogScan {
  readonly records: LogRecord[]
  readonly unparsedLineCount: number
  readonly skippedFileCount: number
  readonly truncated: boolean
}

export interface ScanRule {
  /** Stable kebab-case id prefixed with its domain, e.g. `provider-rate-limited`. */
  readonly id: string
  readonly domain: DiagnosticDomain
  readonly attribution: ScanAttribution
  /** English, developer-facing: what happened and where the cause points. */
  readonly devMessage: string
  readonly levels?: readonly ScanLevel[]
  readonly modules?: readonly string[]
  readonly anchors: readonly RegExp[]
  readonly exclude?: readonly RegExp[]
}

export interface FindingEvidence {
  readonly timestampMs: number
  readonly excerpt: string
  readonly module?: string
  readonly source?: { readonly file: string; readonly line: number }
}

export interface Finding {
  readonly ruleId: string
  readonly domain: DiagnosticDomain
  readonly attribution: ScanAttribution
  readonly devMessage: string
  readonly count: number
  readonly firstSeenMs: number
  readonly lastSeenMs: number
  readonly evidence: readonly FindingEvidence[]
}

export interface ScanReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly range: { readonly from: string; readonly to: string }
  readonly scannedRecordCount: number
  readonly unparsedLineCount: number
  readonly skippedFileCount: number
  readonly truncated: boolean
  readonly rulesEvaluated: number
  readonly findings: readonly Finding[]
}
