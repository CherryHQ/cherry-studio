import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { usePreference } from '@renderer/data/hooks/usePreference'

import { TaskTimingPane } from './TaskTimingPane'
import { TracePage } from './TracePage'

export interface TracePanePayload {
  topicId: string
  traceId: string
}

export function TracePane({ payload }: { payload: TracePanePayload | null }) {
  const [detailed, setDetailed] = useState(false)
  const [developerMode] = usePreference('app.developer_mode.enabled')
  const { t } = useTranslation()
  if (!payload) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {payload.topicId.startsWith('agent-session:') ? (
        <>
          {developerMode && (
            <Button size="sm" variant="ghost" onClick={() => setDetailed(!detailed)}>
              {detailed ? t('trace.timing.title') : t('trace.timing.detailed')}
            </Button>
          )}
          {detailed && developerMode ? (
            <TracePage topicId={payload.topicId} traceId={payload.traceId} />
          ) : (
            <TaskTimingPane key={payload.topicId} sessionId={payload.topicId.slice('agent-session:'.length)} />
          )}
        </>
      ) : (
        <TracePage topicId={payload.topicId} traceId={payload.traceId} />
      )}
    </div>
  )
}
