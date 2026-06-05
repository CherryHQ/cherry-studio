/**
 * Initialization payload for the trace window.
 *
 * Delivered main -> renderer via WindowManager init data.
 */
export type TraceWindowInitData = {
  topicId: string
  traceId: string
  modelName?: string
  title?: string
}
