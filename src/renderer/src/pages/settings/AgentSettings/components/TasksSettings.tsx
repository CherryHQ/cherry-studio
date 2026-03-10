import { useCreateTask, useDeleteTask, useTasks, useUpdateTask } from '@renderer/hooks/agents/useTasks'
import type { ScheduledTaskEntity } from '@renderer/types'
import { Button, Empty, Spin } from 'antd'
import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsTitle } from '../shared'
import TaskFormModal from './TaskFormModal'
import TaskListItem from './TaskListItem'
import TaskLogsModal from './TaskLogsModal'

const TasksSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase }) => {
  const { t } = useTranslation()
  const agentId = agentBase?.id ?? null
  const { tasks, isLoading } = useTasks(agentId)
  const { createTask } = useCreateTask(agentId ?? '')
  const { updateTask } = useUpdateTask(agentId ?? '')
  const { deleteTask } = useDeleteTask(agentId ?? '')

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

  const handleDelete = async (taskId: string) => {
    await deleteTask(taskId)
  }

  return (
    <SettingsContainer>
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
