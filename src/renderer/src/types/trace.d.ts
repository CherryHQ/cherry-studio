export type TraceProviderType = 'langfuse'

export type LangfuseSettings = {
  baseUrl: string
  publicKey: string
  secretKey: string
}

export type MessageTraceStartSpec = {
  /** 消息 id，对应于 trace */
  id: string
  messages?: Message[]
  /** 用于追踪一个话题 */
  sessionId?: string
  name?: string
  tags?: string[]
  version?: string
  model?: string
}

export type MessageTraceStopSpec = {
  /** 消息 id，对应于 trace */
  id: string
}

export type ObservationStartSpec = {
  /** 消息块 id，对应于 observation */
  id: string
  parentId?: string
  name?: string
  model?: string
}

export type ObservationStopSpec = {
  /** 消息块 id，对应于 observation */
  id: string
  parentId: string
}
