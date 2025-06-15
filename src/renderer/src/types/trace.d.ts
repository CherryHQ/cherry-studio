export type TraceProviderType = 'langfuse'

export type LangfuseSettings = {
  baseUrl: string
  publicKey: string
  secretKey: string
}

export type BaseTraceSpec = {
  /** 用于追踪一轮对话 */
  id?: string
  /** 用于追踪一个话题 */
  sessionId?: string
  name?: string
  tags?: string[]
  version?: string
}

export type BaseObservationSpec = {
  name?: string
  model?: string
}
