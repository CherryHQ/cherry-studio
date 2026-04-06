export * from './dataUIParts'
export * from './schemas'

/** Context payload sent with each AI chat request via body. */
export interface AiChatRequestBody {
  /** Topic ID for message routing and persistence. */
  topicId: string
  /** Assistant configuration ID. */
  assistantId?: string
  /** Models mentioned via @ in the input (multi-model fan-out). */
  mentionedModels?: Array<{ id: string; name?: string }>
  /** Uploaded file metadata. */
  files?: Array<{ id: string; name: string; type: string; size: number; url: string }>
  /** OpenTelemetry trace ID for request tracing. */
  traceId?: string
}
