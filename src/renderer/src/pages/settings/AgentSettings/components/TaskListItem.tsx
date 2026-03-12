import type { ScheduledTaskEntity } from '@renderer/types'
import { Button, Popconfirm, Tag, Tooltip } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

type TaskListItemProps = {
  task: ScheduledTaskEntity
  onEdit: (task: ScheduledTaskEntity) => void
  onToggleStatus: (task: ScheduledTaskEntity) => void
  onDelete: (taskId: string) => void
  onRun: (task: ScheduledTaskEntity) => void
  onViewLogs: (task: ScheduledTaskEntity) => void
}

const statusColors: Record<string, string> = {
  active: 'green',
  paused: 'orange',
  completed: 'blue'
}

const scheduleTypeLabels: Record<string, string> = {
  cron: 'Cron',
  interval: 'Interval',
  once: 'Once'
}

const TaskListItem: FC<TaskListItemProps> = ({ task, onEdit, onToggleStatus, onDelete, onRun, onViewLogs }) => {
  const { t } = useTranslation()

  const formatScheduleValue = () => {
    if (task.schedule_type === 'cron') return task.schedule_value
    if (task.schedule_type === 'interval') return `${task.schedule_value} min`
    if (task.schedule_type === 'once' && task.schedule_value) {
      return new Date(task.schedule_value).toLocaleString()
    }
    return task.schedule_value
  }

  const formatTime = (iso: string | null | undefined) => {
    if (!iso) return '-'
    const d = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()

    if (diff < 60_000) return 'just now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
    return d.toLocaleDateString()
  }

  const isCompleted = task.status === 'completed'

  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Tag color={statusColors[task.status]}>{t(`agent.cherryClaw.tasks.status.${task.status}`)}</Tag>
          <span className="truncate font-medium">{task.name}</span>
          <Tag>{scheduleTypeLabels[task.schedule_type]}</Tag>
        </div>
        <div className="mt-1 flex gap-4 text-gray-400 text-xs">
          <span>{formatScheduleValue()}</span>
          {task.next_run && (
            <span>
              {t('agent.cherryClaw.tasks.nextRun')}: {formatTime(task.next_run)}
            </span>
          )}
          {task.last_run && (
            <span>
              {t('agent.cherryClaw.tasks.lastRun')}: {formatTime(task.last_run)}
            </span>
          )}
        </div>
        {task.last_result && (
          <Tooltip title={task.last_result}>
            <div className="mt-1 max-w-[400px] truncate text-gray-500 text-xs">{task.last_result}</div>
          </Tooltip>
        )}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-1">
        {!isCompleted && (
          <Button size="small" type="text" onClick={() => onRun(task)}>
            {t('agent.cherryClaw.tasks.run')}
          </Button>
        )}
        <Button size="small" type="text" onClick={() => onViewLogs(task)}>
          {t('agent.cherryClaw.tasks.logs.label')}
        </Button>
        {!isCompleted && (
          <Button size="small" type="text" onClick={() => onEdit(task)}>
            {t('agent.cherryClaw.tasks.edit')}
          </Button>
        )}
        {!isCompleted && (
          <Button size="small" type="text" onClick={() => onToggleStatus(task)}>
            {task.status === 'active' ? t('agent.cherryClaw.tasks.pause') : t('agent.cherryClaw.tasks.resume')}
          </Button>
        )}
        <Popconfirm
          title={t('agent.cherryClaw.tasks.delete.confirm')}
          onConfirm={() => onDelete(task.id)}
          okText={t('agent.cherryClaw.tasks.delete.label')}
          cancelText={t('agent.cherryClaw.tasks.cancel')}>
          <Button size="small" type="text" danger>
            {t('agent.cherryClaw.tasks.delete.label')}
          </Button>
        </Popconfirm>
      </div>
    </div>
  )
}

export default TaskListItem
