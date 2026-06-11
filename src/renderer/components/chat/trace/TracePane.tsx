import { TracePage } from './TracePage'

export interface TracePanePayload {
  topicId: string
  traceId: string
}

export function TracePane({ payload }: { payload: TracePanePayload | null }) {
  if (!payload) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <TracePage topicId={payload.topicId} traceId={payload.traceId} reload={`${payload.topicId}:${payload.traceId}`} />
    </div>
  )
}
