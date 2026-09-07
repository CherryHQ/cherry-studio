import type { DiagnosticTimeRange } from '../types'
import { SCAN_RULES } from './rules/registry'
import type { ErrorLogScan, Finding, FindingEvidence, LogRecord, ScanReport, ScanRule } from './types'

const DEFAULT_MAX_EVIDENCE = 3
const EXCERPT_MESSAGE_CHARS = 200
const EXCERPT_STACK_CHARS = 120

/** Archive entry name inside the diagnostic bundle zip. */
export const SCAN_REPORT_ARCHIVE_NAME = 'scan/findings.json'

export interface DiagnoseOptions {
  /** Rule set override, mainly for tests; defaults to the full rule set. */
  readonly rules?: readonly ScanRule[]
}

function haystack(record: LogRecord): string {
  return `${record.message}\n${record.stack ?? ''}\n${record.detail ?? ''}`
}

function moduleMatches(recordModule: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => recordModule === entry || recordModule.startsWith(`${entry}:`))
}

function matches(rule: ScanRule, record: LogRecord, text: string): boolean {
  if (rule.levels && !rule.levels.includes(record.level)) return false
  // records without module predate the logger fix — degrade to anchors instead of going blind
  if (rule.modules && record.module !== undefined && !moduleMatches(record.module, rule.modules)) return false
  if (!rule.anchors.every((anchor) => anchor.test(text))) return false
  if (rule.exclude?.some((pattern) => pattern.test(text))) return false
  return true
}

function toEvidence(record: LogRecord): FindingEvidence {
  const stackFirstLine = record.stack?.split('\n', 1)[0]
  const excerpt = [record.message.slice(0, EXCERPT_MESSAGE_CHARS), stackFirstLine?.slice(0, EXCERPT_STACK_CHARS)]
    .filter(Boolean)
    .join(' | ')
  return {
    timestampMs: record.timestampMs,
    excerpt,
    ...(record.module !== undefined && { module: record.module }),
    ...(record.source !== undefined && { source: record.source })
  }
}

interface FindingAccumulator {
  rule: ScanRule
  count: number
  firstSeenMs: number
  lastSeenMs: number
  evidence: FindingEvidence[]
}

/**
 * Evaluates every rule against every record and aggregates matches per rule.
 * Pure: no filesystem or Electron access — records come from a source adapter.
 */
export function diagnose(records: Iterable<LogRecord>, options?: DiagnoseOptions): Finding[] {
  const rules = options?.rules ?? SCAN_RULES
  const accumulators = new Map<string, FindingAccumulator>()

  for (const record of records) {
    const text = haystack(record)
    for (const rule of rules) {
      if (!matches(rule, record, text)) continue
      let accumulator = accumulators.get(rule.id)
      if (!accumulator) {
        accumulator = {
          rule,
          count: 0,
          firstSeenMs: record.timestampMs,
          lastSeenMs: record.timestampMs,
          evidence: []
        }
        accumulators.set(rule.id, accumulator)
      }
      accumulator.count += 1
      accumulator.firstSeenMs = Math.min(accumulator.firstSeenMs, record.timestampMs)
      accumulator.lastSeenMs = Math.max(accumulator.lastSeenMs, record.timestampMs)
      if (accumulator.evidence.length < DEFAULT_MAX_EVIDENCE) accumulator.evidence.push(toEvidence(record))
    }
  }

  return [...accumulators.values()]
    .map(({ rule, ...aggregate }) => ({
      ruleId: rule.id,
      domain: rule.domain,
      attribution: rule.attribution,
      devMessage: rule.devMessage,
      ...aggregate
    }))
    .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId))
}

export function buildScanReport(
  findings: readonly Finding[],
  input: { range: DiagnosticTimeRange } & Omit<ErrorLogScan, 'records'> & {
      scannedRecordCount: number
      /** Defaults to the shipped rule set; pass it when `diagnose` ran a custom one. */
      rulesEvaluated?: number
    }
): ScanReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date(input.range.toMs).toISOString(),
    range: {
      from: new Date(input.range.fromMs).toISOString(),
      to: new Date(input.range.toMs).toISOString()
    },
    scannedRecordCount: input.scannedRecordCount,
    unparsedLineCount: input.unparsedLineCount,
    skippedFileCount: input.skippedFileCount,
    truncated: input.truncated,
    rulesEvaluated: input.rulesEvaluated ?? SCAN_RULES.length,
    findings
  }
}

export function serializeScanReport(report: ScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
