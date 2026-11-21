export interface PythonExecutionRequest {
  id: string
  script: string
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Context stays unvalidated until the worker's JSON round trip; preserve its omission, coercion and failure behavior.
  context: Record<string, unknown>
  timeout: number
}

export interface PythonExecutionResponse {
  id: string
  result?: string
  error?: string
}
