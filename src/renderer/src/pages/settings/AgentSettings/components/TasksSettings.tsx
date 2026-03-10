import { useCreateTask, useDeleteTask, useRunTask, useTasks, useUpdateTask } from '@renderer/hooks/agents/useTasks'
import type {
  CherryClawConfiguration,
  GetAgentResponse,
  ScheduledTaskEntity,
  UpdateAgentBaseForm,
  UpdateAgentFunction
} from '@renderer/types'
import { Button, Empty, InputNumber, Spin, Switch, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { type FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'
import TaskFormModal from './TaskFormModal'
import TaskListItem from './TaskListItem'
import TaskLogsModal from './TaskLogsModal'

// --------------- Heartbeat section ---------------

type HeartbeatProps = {
  agentBase: GetAgentResponse
  update: UpdateAgentFunction
}

const HeartbeatSection: FC<HeartbeatProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()

  const config = useMemo(() => (agentBase?.configuration ?? {}) as CherryClawConfiguration, [agentBase?.configuration])
  const heartbeatEnabled = config.heartbeat_enabled !== false
  const heartbeatInterval = config.heartbeat_interval ?? 30

  const [intervalInput, setIntervalInput] = useState(heartbeatInterval)

  const updateConfig = useCallback(
    (updates: Partial<CherryClawConfiguration>) => {
      if (!agentBase) return
      update({
        id: agentBase.id,
        configuration: { ...config, ...updates }
      } satisfies UpdateAgentBaseForm)
    },
    [agentBase, config, update]
  )

  const handleToggle = useCallback(
    (checked: boolean) => {
      updateConfig({ heartbeat_enabled: checked })
    },
    [updateConfig]
  )

  const commitInterval = useCallback(() => {
    if (!Number.isFinite(intervalInput) || intervalInput < 1) {
      setIntervalInput(heartbeatInterval)
      return
    }
    if (intervalInput !== heartbeatInterval) {
      updateConfig({ heartbeat_interval: intervalInput })
    }
  }, [intervalInput, heartbeatInterval, updateConfig])

  if (!agentBase) return null

  return (
    <SettingsItem>
      <div className="flex items-center justify-between">
        <SettingsTitle
          contentAfter={
            <Tooltip title={t('agent.cherryClaw.heartbeat.enabledHelper')} placement="right">
              <Info size={16} className="text-foreground-400" />
            </Tooltip>
          }>
          {t('agent.cherryClaw.heartbeat.enabled')}
        </SettingsTitle>
        <Switch checked={heartbeatEnabled} size="small" onChange={handleToggle} />
      </div>
      {heartbeatEnabled && (
        <div className="mt-2 flex flex-col gap-1">
          <label className="font-medium text-xs">{t('agent.cherryClaw.heartbeat.interval')}</label>
          <InputNumber
            min={1}
            value={intervalInput}
            onChange={(value) => setIntervalInput(value ?? 30)}
            onBlur={commitInterval}
            onPressEnter={commitInterval}
            style={{ width: '100%' }}
            size="small"
          />
          <span className="text-foreground-500 text-xs">{t('agent.cherryClaw.heartbeat.intervalHelper')}</span>
        </div>
      )}
    </SettingsItem>
  )
}

// --------------- Main tasks section ---------------

const TasksSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const agentId = agentBase?.id ?? null
  const { tasks, isLoading } = useTasks(agentId)
  const { createTask } = useCreateTask(agentId ?? '')
  const { updateTask } = useUpdateTask(agentId ?? '')
  const { deleteTask } = useDeleteTask(agentId ?? '')
  const { runTask } = useRunTask(agentId ?? '')

  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTaskEntity | null>(null)
  const [logsTask, setLogsTask] = useState<ScheduledTaskEntity | null>(null)

  if (!agentBase) return null

  const handleAdd = () => {
    setEditingTask(null)
    setFormOpen(true)
  }

  const handleEdit = (task: ScheduledTaskEntity) => {
    setEditingTask(task)
    setFormOpen(true)
  }

  const handleSave = async (data: any) => {
    if (editingTask) {
      await updateTask(editingTask.id, data)
    } else {
      await createTask(data)
    }
    setFormOpen(false)
    setEditingTask(null)
  }

  const handleToggleStatus = async (task: ScheduledTaskEntity) => {
    const newStatus = task.status === 'active' ? 'paused' : 'active'
    await updateTask(task.id, { status: newStatus })
  }

  const handleRun = async (task: ScheduledTaskEntity) => {
    await runTask(task.id)
  }

  const handleDelete = async (taskId: string) => {
    await deleteTask(taskId)
  }

  return (
    <SettingsContainer>
      {/* Heartbeat settings — only shown for agent-level settings (not session) */}
      {'type' in agentBase && (
        <HeartbeatSection agentBase={agentBase as GetAgentResponse} update={update as UpdateAgentFunction} />
      )}

      {/* Regular tasks */}
      <div className="mb-3 flex items-center justify-between">
        <SettingsTitle>{t('agent.cherryClaw.tasks.title')}</SettingsTitle>
        <Button type="primary" size="small" onClick={handleAdd}>
          {t('agent.cherryClaw.tasks.add')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spin />
        </div>
      ) : tasks.length === 0 ? (
        <Empty description={t('agent.cherryClaw.tasks.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              onEdit={handleEdit}
              onToggleStatus={handleToggleStatus}
              onDelete={handleDelete}
              onRun={handleRun}
              onViewLogs={setLogsTask}
            />
          ))}
        </div>
      )}

      <TaskFormModal
        open={formOpen}
        isEdit={!!editingTask}
        initialData={
          editingTask
            ? {
                name: editingTask.name,
                prompt: editingTask.prompt,
                schedule_type: editingTask.schedule_type,
                schedule_value: editingTask.schedule_value,
                context_mode: editingTask.context_mode
              }
            : undefined
        }
        onSave={handleSave}
        onCancel={() => {
          setFormOpen(false)
          setEditingTask(null)
        }}
      />

      <TaskLogsModal
        open={!!logsTask}
        agentId={agentId ?? ''}
        taskId={logsTask?.id ?? null}
        taskName={logsTask?.name ?? ''}
        onClose={() => setLogsTask(null)}
      />
    </SettingsContainer>
  )
}

export default TasksSettings
