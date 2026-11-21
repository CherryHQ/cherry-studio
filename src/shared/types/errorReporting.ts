export interface FailureFacts {
  source: 'application' | 'sdk' | 'provider' | 'tool' | 'environment'
  kind: 'defect' | 'reliability' | 'expected' | 'unknown'
  reason: string
  outcome: 'retrying' | 'recovered' | 'failed' | 'cancelled'
  runtime?: 'claude-code' | 'pi' | 'ai-sdk'
}

export interface ErrorObservation {
  error?: Error
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Logger observations retain arbitrary caller data; reporting validates consumed fields before building sanitized capture context.
  entry: Record<string, unknown>
}
