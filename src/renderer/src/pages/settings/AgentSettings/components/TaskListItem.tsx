import type { ScheduledTaskEntity } from '@renderer/types'
import { Popconfirm, Tag, Tooltip } from 'antd'
import { Clock, Edit2, History, Pause, Play, Trash2 } from 'lucide-react'
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

const statusDotColors: Record<string, string> = {
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  completed: 'bg-blue-500'
}

const scheduleTypeConfig: Record<string, { label: string; color: string }> = {
  cron: { label: 'Cron', color: 'purple' },
  interval: { label: 'Interval', color: 'blue' },
  once: { label: 'Once', color: 'orange' }
}

const IconButton: FC<{
  icon: React.ReactNode
  tooltip: string
  onClick: () => void
  danger?: boolean
}> = ({ icon, tooltip, onClick, danger }) => (
  <Tooltip title={tooltip}>
    <button
      type="button"
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-fill-secondary)] ${danger ? 'text-red-500 hover:text-red-600' : 'text-foreground-400 hover:text-foreground'}`}
      onClick={onClick}>
      {icon}
    </button>
  </Tooltip>
)

const TaskListItem: FC<TaskListItemProps> = ({ task, onEdit, onToggleStatus, onDelete, onRun, onViewLogs }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  const formatScheduleValue = () => {
    if (task.schedule_type === 'cron') return task.schedule_value
    if (task.schedule_type === 'interval') return `${task.schedule_value} min`
    if (task.schedule_type === 'once' && task.schedule_value) {
      return new Date(task.schedule_value).toLocaleString(locale)
    }
    return task.schedule_value
  }

  const formatTime = (iso: string | null | undefined) => {
    if (!iso) return '-'
    const d = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()

    if (diff < 60_000) return t('agent.cherryClaw.tasks.logs.justNow', 'just now')
    if (diff < 3600_000) return t('agent.cherryClaw.tasks.time.minutesAgo', { count: Math.floor(diff / 60_000) })
    if (diff < 86400_000) return t('agent.cherryClaw.tasks.time.hoursAgo', { count: Math.floor(diff / 3600_000) })
    return d.toLocaleDateString(locale)
  }

  const isCompleted = task.status === 'completed'
  const typeConfig = scheduleTypeConfig[task.schedule_type] ?? { label: task.schedule_type, color: 'default' }

  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDotColors[task.status] ?? 'bg-gray-400'}`}
          />
          <span className="truncate font-medium text-sm">{task.name}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <Tag color={typeConfig.color} className="!mr-0">
            {typeConfig.label}
          </Tag>
          <span className="text-foreground-400">
            <Clock size={11} className="mr-0.5 inline" />
            {formatScheduleValue()}
          </span>
          {task.next_run && <span className="text-foreground-400">→ Next: {formatTime(task.next_run)}</span>}
          {task.last_run && <span className="text-foreground-400">Last: {formatTime(task.last_run)}</span>}
        </div>
        {task.last_result && (
          <Tooltip title={task.last_result}>
            <div className="mt-1 max-w-[400px] truncate text-foreground-500 text-xs">{task.last_result}</div>
          </Tooltip>
        )}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-0.5">
        {!isCompleted && (
          <IconButton icon={<Play size={14} />} tooltip={t('agent.cherryClaw.tasks.run')} onClick={() => onRun(task)} />
        )}
        <IconButton
          icon={<History size={14} />}
          tooltip={t('agent.cherryClaw.tasks.logs.label')}
          onClick={() => onViewLogs(task)}
        />
        {!isCompleted && (
          <IconButton
            icon={<Edit2 size={14} />}
            tooltip={t('agent.cherryClaw.tasks.edit')}
            onClick={() => onEdit(task)}
          />
        )}
        {!isCompleted && (
          <IconButton
            icon={<Pause size={14} />}
            tooltip={task.status === 'active' ? t('agent.cherryClaw.tasks.pause') : t('agent.cherryClaw.tasks.resume')}
            onClick={() => onToggleStatus(task)}
          />
        )}
        <Popconfirm
          title={t('agent.cherryClaw.tasks.delete.confirm')}
          onConfirm={() => onDelete(task.id)}
          okText={t('agent.cherryClaw.tasks.delete.label')}
          cancelText={t('agent.cherryClaw.tasks.cancel')}>
          <IconButton
            icon={<Trash2 size={14} />}
            tooltip={t('agent.cherryClaw.tasks.delete.label')}
            onClick={() => {}}
            danger
          />
        </Popconfirm>
      </div>
    </div>
  )
}

export default TaskListItem
