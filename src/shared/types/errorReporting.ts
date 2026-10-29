export interface FailureFacts {
  source: 'application' | 'sdk' | 'provider' | 'tool' | 'environment'
  kind: 'defect' | 'reliability' | 'expected' | 'unknown'
  reason: string
  outcome: 'retrying' | 'recovered' | 'failed' | 'cancelled'
  runtime?: 'claude-code' | 'pi' | 'ai-sdk'
}

export interface ErrorObservation {
  error?: Error
  entry: Record<string, unknown>
}
