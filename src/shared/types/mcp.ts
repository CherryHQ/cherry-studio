export type McpProgressEvent = {
  callId: string
  progress: number // 0-1 range
}

export type McpServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'stderr' | 'stdout'
  message: string
  data?: any
  source?: string
}
