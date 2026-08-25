export {
  buildScanReport,
  diagnose,
  type DiagnoseOptions,
  SCAN_REPORT_ARCHIVE_NAME,
  serializeScanReport
} from './engine'
export { collectErrorLogRecords, MAX_SCAN_RECORDS, parseErrorLogLine } from './logFileSource'
export { SCAN_RULES } from './rules/registry'
export type {
  DiagnosticDomain,
  ErrorLogScan,
  Finding,
  FindingEvidence,
  LogRecord,
  ScanAttribution,
  ScanLevel,
  ScanReport,
  ScanRule
} from './types'
export { DIAGNOSTIC_DOMAINS } from './types'
