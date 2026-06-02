import { TracePage } from './TracePage'

export interface TracePanePayload {
  topicId: string
  traceId: string
  modelName?: string
}

export function TracePane({ payload }: { payload: TracePanePayload | null }) {
  if (!payload) {
    return null
  }

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      <TracePage
        topicId={payload.topicId}
        traceId={payload.traceId}
        modelName={payload.modelName}
        reload={`${payload.topicId}:${payload.traceId}:${payload.modelName ?? ''}`}
      />
    </div>
  )
}
