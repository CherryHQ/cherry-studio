import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Button } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { TaskTimingNode } from '@shared/ai/taskTiming'

export function TaskTimingPane({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const [taskId, setTaskId] = useState<string>()
  const [offset, setOffset] = useState(0)
  const [taskOffset, setTaskOffset] = useState(0)
  const [byDuration, setByDuration] = useState(false)
  const tasks = useSWR(
    ['task-timing-list', sessionId, taskOffset],
    () => ipcApi.request('ai.agent.session.timing', { sessionId, list: true, offset: taskOffset, limit: 100 }),
    { refreshInterval: 2000 }
  )
  const selected = taskId ?? tasks.data?.tasks[0]?.taskId
  const details = useSWR(
    selected ? ['task-timing', sessionId, selected, offset, byDuration] : null,
    () =>
      ipcApi.request('ai.agent.session.timing', {
        sessionId,
        taskId: selected,
        offset,
        limit: 100,
        sort: byDuration ? 'duration' : 'time'
      }),
    { refreshInterval: 2000 }
  )
  const statusLabels = {
    running: t('trace.timing.status.running'),
    waiting: t('trace.timing.status.waiting'),
    success: t('trace.timing.status.success'),
    failed: t('trace.timing.status.failed'),
    cancelled: t('trace.timing.status.cancelled'),
    interrupted: t('trace.timing.status.interrupted')
  }
  const nodes = [...(details.data?.nodes ?? [])]
  const nodeName = (node: TaskTimingNode) =>
    node.name === 'agent.task'
      ? t('trace.timing.title')
      : node.name === 'agent.queue'
        ? t('trace.timing.queue')
        : node.name === 'agent.approval'
          ? t('trace.timing.approval')
          : node.name === 'agent.subagent'
            ? t('trace.agent')
            : node.name
  const duration = (node: TaskTimingNode) =>
    node.durationMs === null ? t('trace.timing.unavailable') : `${node.durationMs.toFixed(3)} ms`
  const time = (value: number | null) =>
    value === null
      ? t('trace.timing.unavailable')
      : new Date(value).toLocaleString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
          hour12: false
        })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-xs">
      <p className="text-muted-foreground">{t('trace.timing.description')}</p>
      {(tasks.error || details.error) && <p role="alert">{t('trace.pollError')}</p>}
      {tasks.isLoading && <p>{t('trace.timing.loading')}</p>}
      {tasks.data?.tasks.length === 0 && <p>{t('trace.timing.unavailable')}</p>}
      <div className="flex flex-wrap gap-2">
        {tasks.data?.tasks.map((task) => (
          <Button
            key={task.id}
            size="sm"
            variant={selected === task.taskId ? 'secondary' : 'ghost'}
            onClick={() => {
              setTaskId(task.taskId)
              setOffset(0)
            }}>
            {time(task.startTime)} · {duration(task)}
          </Button>
        ))}
        {taskOffset > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setTaskOffset(Math.max(0, taskOffset - 100))}>
            {t('trace.timing.previous')}
          </Button>
        )}
        {tasks.data?.nextOffset !== null && tasks.data?.nextOffset !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => setTaskOffset(tasks.data!.nextOffset!)}>
            {t('trace.timing.next')}
          </Button>
        )}
      </div>
      {details.data?.availability !== 'available' && details.data && (
        <p className="text-muted-foreground">{t('trace.timing.incomplete')}</p>
      )}
      {selected && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setByDuration(!byDuration)
            setOffset(0)
          }}>
          {byDuration ? t('trace.timing.order') : t('trace.timing.sort')}
        </Button>
      )}
      {nodes.map((node) => (
        <div key={node.id} className="flex flex-col gap-1 border-b pb-3">
          <div className="flex justify-between gap-2">
            <span>{nodeName(node)}</span>
            <span>{duration(node)}</span>
          </div>
          <span>{statusLabels[node.status]}</span>
          <span className="text-muted-foreground">
            {t('trace.startTime')}: {time(node.startTime)}
          </span>
          <span className="text-muted-foreground">
            {t('trace.endTime')}: {time(node.endTime)}
          </span>
          {node.parentId && (
            <span className="text-muted-foreground">
              {t('trace.timing.parent')}:{' '}
              {nodes.find((parent) => parent.id === node.parentId)
                ? nodeName(nodes.find((parent) => parent.id === node.parentId)!)
                : node.parentId}
            </span>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {offset > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setOffset(Math.max(0, offset - 100))}>
            {t('trace.timing.previous')}
          </Button>
        )}
        {details.data?.nextOffset !== null && details.data?.nextOffset !== undefined && (
          <Button variant="ghost" size="sm" onClick={() => setOffset(details.data!.nextOffset!)}>
            {t('trace.timing.next')}
          </Button>
        )}
      </div>
    </div>
  )
}
