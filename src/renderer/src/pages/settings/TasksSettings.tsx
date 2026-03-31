import { PlusOutlined } from '@ant-design/icons'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAgentClient } from '@renderer/hooks/agents/useAgentClient'
import { useChannels } from '@renderer/hooks/agents/useChannels'
import { useTaskLogs } from '@renderer/hooks/agents/useTasks'
import type { CreateTaskRequest, ScheduledTaskEntity, UpdateTaskRequest } from '@renderer/types'
import { Button, Empty, Flex, Input, Popconfirm, Select, Spin, Table, Tag } from 'antd'
import { Clock, Pause, Play, Trash2 } from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

// --------------- Types ---------------

type AgentInfo = { id: string; name: string }
type ChannelInfo = { id: string; name: string }

// --------------- Task Detail (right panel) ---------------

const TaskDetail: FC<{
  task: ScheduledTaskEntity
  agentName: string
  channels: ChannelInfo[]
  onUpdate: (taskId: string, updates: UpdateTaskRequest) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onRun: (taskId: string) => Promise<void>
  onToggleStatus: (taskId: string, newStatus: string) => Promise<void>
}> = ({ task, agentName, channels, onUpdate, onDelete, onRun, onToggleStatus }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const isCompleted = task.status === 'completed'
  const statusColors: Record<string, string> = { active: 'green', paused: 'orange', completed: 'blue' }

  const [name, setName] = useState(task.name)
  const [prompt, setPrompt] = useState(task.prompt)
  const [scheduleType, setScheduleType] = useState(task.schedule_type)
  const [scheduleValue, setScheduleValue] = useState(task.schedule_value)
  const [channelIds, setChannelIds] = useState<string[]>(task.channel_ids ?? [])

  useEffect(() => {
    setName(task.name)
    setPrompt(task.prompt)
    setScheduleType(task.schedule_type)
    setScheduleValue(task.schedule_value)
    setChannelIds(task.channel_ids ?? [])
  }, [task])

  const saveField = useCallback(
    (updates: UpdateTaskRequest) => {
      void onUpdate(task.id, updates)
    },
    [task.id, onUpdate]
  )

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
    if (diff < 60_000) return t('agent.cherryClaw.tasks.logs.justNow', 'just now')
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
    return d.toLocaleDateString()
  }

  return (
    <SettingContainer theme={theme}>
      {/* Header card */}
      <SettingGroup theme={theme}>
        <SettingTitle>
          <div className="flex items-center gap-2">
            <Tag color={statusColors[task.status] ?? 'default'}>{task.status}</Tag>
            <span className="text-[var(--color-text-3)] text-xs">{agentName}</span>
          </div>
          <div className="flex items-center gap-1">
            {!isCompleted && (
              <Button
                size="small"
                icon={<Play size={14} />}
                onClick={() => onRun(task.id)}
                title={t('agent.cherryClaw.tasks.run')}
              />
            )}
            {!isCompleted && (
              <Button
                size="small"
                icon={<Pause size={14} />}
                onClick={() => onToggleStatus(task.id, task.status === 'active' ? 'paused' : 'active')}
                title={
                  task.status === 'active' ? t('agent.cherryClaw.tasks.pause') : t('agent.cherryClaw.tasks.resume')
                }
              />
            )}
            <Popconfirm
              title={t('agent.cherryClaw.tasks.delete.confirm')}
              onConfirm={() => onDelete(task.id)}
              okText={t('agent.cherryClaw.tasks.delete.label')}
              cancelText={t('agent.cherryClaw.tasks.cancel')}>
              <Button size="small" danger icon={<Trash2 size={14} />} />
            </Popconfirm>
          </div>
        </SettingTitle>
        <SettingDivider />
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Tag color={scheduleTypeConfig[task.schedule_type]?.color ?? 'default'}>
            {scheduleTypeConfig[task.schedule_type]?.label ?? task.schedule_type}
          </Tag>
          <span className="text-[var(--color-text-3)]">
            <Clock size={11} className="mr-0.5 inline" />
            {formatScheduleValue()}
          </span>
          {task.next_run && <span className="text-[var(--color-text-3)]">Next: {formatTime(task.next_run)}</span>}
          {task.last_run && <span className="text-[var(--color-text-3)]">Last: {formatTime(task.last_run)}</span>}
        </div>
      </SettingGroup>

      {/* Editable fields card */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <SettingRowTitle>{t('agent.cherryClaw.tasks.name.label')}</SettingRowTitle>
          <Input
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== task.name && saveField({ name: name.trim() })}
            disabled={isCompleted}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <SettingRowTitle>{t('agent.cherryClaw.tasks.prompt.label')}</SettingRowTitle>
          <Input.TextArea
            size="small"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => prompt.trim() && prompt !== task.prompt && saveField({ prompt: prompt.trim() })}
            disabled={isCompleted}
          />
        </SettingRow>
        <SettingDivider />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleType.label')}</SettingRowTitle>
            <Select
              size="small"
              className="w-full"
              value={scheduleType}
              disabled={isCompleted}
              onChange={(value) => {
                setScheduleType(value)
                setScheduleValue('')
                saveField({ schedule_type: value, schedule_value: '' })
              }}
              options={[
                { value: 'cron', label: t('agent.cherryClaw.tasks.scheduleType.cron') },
                { value: 'interval', label: t('agent.cherryClaw.tasks.scheduleType.interval') },
                { value: 'once', label: t('agent.cherryClaw.tasks.scheduleType.once') }
              ]}
            />
          </div>
          <div>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleValue')}</SettingRowTitle>
            {scheduleType === 'cron' && (
              <Input
                size="small"
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                onBlur={() =>
                  scheduleValue.trim() &&
                  scheduleValue !== task.schedule_value &&
                  saveField({ schedule_value: scheduleValue.trim() })
                }
                placeholder={t('agent.cherryClaw.tasks.cronPlaceholder')}
                disabled={isCompleted}
              />
            )}
            {scheduleType === 'interval' && (
              <Input
                size="small"
                type="number"
                min={1}
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                onBlur={() =>
                  scheduleValue.trim() &&
                  scheduleValue !== task.schedule_value &&
                  saveField({ schedule_value: scheduleValue.trim() })
                }
                placeholder={t('agent.cherryClaw.tasks.intervalPlaceholder')}
                suffix="min"
                disabled={isCompleted}
              />
            )}
            {scheduleType === 'once' && (
              <Input
                size="small"
                type="datetime-local"
                value={scheduleValue}
                onChange={(e) => {
                  const iso = new Date(e.target.value).toISOString()
                  setScheduleValue(iso)
                  saveField({ schedule_value: iso })
                }}
                disabled={isCompleted}
              />
            )}
          </div>
        </div>
        {channels.length > 0 && (
          <>
            <SettingDivider />
            <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <SettingRowTitle>{t('agent.cherryClaw.tasks.channels.label')}</SettingRowTitle>
              <Select
                mode="multiple"
                size="small"
                className="w-full"
                value={channelIds}
                disabled={isCompleted}
                onChange={(value) => {
                  setChannelIds(value)
                  saveField({ channel_ids: value })
                }}
                placeholder={t('agent.cherryClaw.tasks.channels.placeholder')}
                options={channels.map((ch) => ({ value: ch.id, label: ch.name }))}
              />
            </SettingRow>
          </>
        )}
      </SettingGroup>

      {/* Logs card */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('agent.cherryClaw.tasks.logs.label')}</SettingTitle>
        <SettingDivider />
        <TaskLogsInline taskId={task.id} />
      </SettingGroup>
    </SettingContainer>
  )
}

// --------------- Inline Logs ---------------

const TaskLogsInline: FC<{ taskId: string }> = ({ taskId }) => {
  const { t } = useTranslation()
  const { logs, isLoading } = useTaskLogs(taskId)

  const columns = [
    {
      title: t('agent.cherryClaw.tasks.logs.runAt'),
      dataIndex: 'run_at',
      key: 'run_at',
      width: 160,
      render: (val: string) => new Date(val).toLocaleString()
    },
    {
      title: t('agent.cherryClaw.tasks.logs.duration'),
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      width: 80,
      render: (val: number) => {
        if (val < 1000) return `${val}ms`
        if (val < 60_000) return `${(val / 1000).toFixed(1)}s`
        return `${(val / 60_000).toFixed(1)}m`
      }
    },
    {
      title: t('agent.cherryClaw.tasks.logs.status'),
      dataIndex: 'status',
      key: 'status',
      width: 70,
      render: (val: string) => <Tag color={val === 'success' ? 'green' : 'red'}>{val}</Tag>
    },
    {
      title: t('agent.cherryClaw.tasks.logs.result'),
      dataIndex: 'result',
      key: 'result',
      ellipsis: true,
      render: (val: string | null, record: any) =>
        record.status === 'error' ? <span className="text-red-500">{record.error}</span> : (val ?? '-')
    }
  ]

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spin size="small" />
      </div>
    )
  }

  if (logs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('agent.cherryClaw.tasks.logs.empty')} />
  }

  return <Table dataSource={logs} columns={columns} rowKey="id" size="small" pagination={false} scroll={{ y: 300 }} />
}

// --------------- Schedule type config ---------------

const scheduleTypeConfig: Record<string, { label: string; color: string }> = {
  cron: { label: 'Cron', color: 'purple' },
  interval: { label: 'Interval', color: 'blue' },
  once: { label: 'Once', color: 'orange' }
}

const statusDotColors: Record<string, string> = {
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  completed: 'bg-blue-500'
}

// --------------- Create Form (right panel) ---------------

const CreateForm: FC<{
  agents: AgentInfo[]
  channels: ChannelInfo[]
  onCancel: () => void
  onCreate: (agentId: string, req: CreateTaskRequest) => Promise<void>
}> = ({ agents, channels, onCancel, onCreate }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [agentId, setAgentId] = useState<string | null>(agents.length === 1 ? agents[0].id : null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>('interval')
  const [scheduleValue, setScheduleValue] = useState('')
  const [channelIds, setChannelIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const isValid = agentId && name.trim() && prompt.trim() && scheduleValue.trim()

  const handleCreate = useCallback(async () => {
    if (!agentId || !name.trim() || !prompt.trim() || !scheduleValue.trim()) return
    setSaving(true)
    try {
      await onCreate(agentId, {
        name: name.trim(),
        prompt: prompt.trim(),
        schedule_type: scheduleType,
        schedule_value: scheduleValue.trim(),
        channel_ids: channelIds.length > 0 ? channelIds : undefined
      })
    } finally {
      setSaving(false)
    }
  }, [agentId, name, prompt, scheduleType, scheduleValue, channelIds, onCreate])

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('agent.cherryClaw.tasks.add')}</SettingTitle>
        <SettingDivider />

        {agents.length > 1 && (
          <>
            <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <SettingRowTitle>{t('agent.cherryClaw.channels.bindAgent')}</SettingRowTitle>
              <Select
                size="small"
                className="w-full"
                value={agentId}
                onChange={setAgentId}
                placeholder={t('agent.cherryClaw.channels.selectAgent')}
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </SettingRow>
            <SettingDivider />
          </>
        )}

        <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <SettingRowTitle>{t('agent.cherryClaw.tasks.name.label')}</SettingRowTitle>
          <Input
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('agent.cherryClaw.tasks.name.placeholder')}
          />
        </SettingRow>
        <SettingDivider />

        <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <SettingRowTitle>{t('agent.cherryClaw.tasks.prompt.label')}</SettingRowTitle>
          <Input.TextArea
            size="small"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('agent.cherryClaw.tasks.prompt.placeholder')}
          />
        </SettingRow>
        <SettingDivider />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleType.label')}</SettingRowTitle>
            <Select
              size="small"
              className="w-full"
              value={scheduleType}
              onChange={(v) => {
                setScheduleType(v)
                setScheduleValue('')
              }}
              options={[
                { value: 'cron', label: t('agent.cherryClaw.tasks.scheduleType.cron') },
                { value: 'interval', label: t('agent.cherryClaw.tasks.scheduleType.interval') },
                { value: 'once', label: t('agent.cherryClaw.tasks.scheduleType.once') }
              ]}
            />
          </div>
          <div>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleValue')}</SettingRowTitle>
            {scheduleType === 'cron' && (
              <Input
                size="small"
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                placeholder={t('agent.cherryClaw.tasks.cronPlaceholder')}
              />
            )}
            {scheduleType === 'interval' && (
              <Input
                size="small"
                type="number"
                min={1}
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                placeholder={t('agent.cherryClaw.tasks.intervalPlaceholder')}
                suffix="min"
              />
            )}
            {scheduleType === 'once' && (
              <Input
                size="small"
                type="datetime-local"
                value={scheduleValue}
                onChange={(e) => setScheduleValue(new Date(e.target.value).toISOString())}
              />
            )}
          </div>
        </div>
        {channels.length > 0 && (
          <>
            <SettingDivider />
            <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <SettingRowTitle>{t('agent.cherryClaw.tasks.channels.label')}</SettingRowTitle>
              <Select
                mode="multiple"
                size="small"
                className="w-full"
                value={channelIds}
                onChange={setChannelIds}
                placeholder={t('agent.cherryClaw.tasks.channels.placeholder')}
                options={channels.map((ch) => ({ value: ch.id, label: ch.name }))}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />

        <div className="flex gap-2">
          <Button size="small" onClick={onCancel}>
            {t('agent.cherryClaw.tasks.cancel')}
          </Button>
          <Button type="primary" size="small" disabled={!isValid} loading={saving} onClick={handleCreate}>
            {t('agent.cherryClaw.tasks.save')}
          </Button>
        </div>
      </SettingGroup>
    </SettingContainer>
  )
}

// --------------- Main component ---------------

const TasksSettings: FC = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const { channels: rawChannels = [] } = useChannels()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [tasks, setTasks] = useState<ScheduledTaskEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const channels: ChannelInfo[] = useMemo(
    () => rawChannels.map((ch: any) => ({ id: ch.id, name: ch.name || ch.type })),
    [rawChannels]
  )

  const loadData = useCallback(async () => {
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        client.listTasks({ limit: 200 }),
        client.listAgents({ limit: 100 })
      ])
      setTasks(tasksRes.data)
      setAgents(agentsRes.data.map((a) => ({ id: a.id, name: a.name ?? a.id })))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId])

  const getAgentName = useCallback((agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId, [agents])

  const handleStartCreate = useCallback(() => {
    setSelectedTaskId(null)
    setCreating(true)
  }, [])

  const handleCreate = useCallback(
    async (agentId: string, req: CreateTaskRequest) => {
      const created = await client.createTask(agentId, req)
      setCreating(false)
      await loadData()
      setSelectedTaskId(created.id)
    },
    [client, loadData]
  )

  const handleUpdate = useCallback(
    async (taskId: string, updates: UpdateTaskRequest) => {
      await client.updateTask(taskId, updates)
      void loadData()
    },
    [client, loadData]
  )

  const handleDelete = useCallback(
    async (taskId: string) => {
      await client.deleteTask(taskId)
      if (selectedTaskId === taskId) setSelectedTaskId(null)
      void loadData()
    },
    [client, selectedTaskId, loadData]
  )

  const handleRun = useCallback(
    async (taskId: string) => {
      await client.runTask(taskId)
      void loadData()
    },
    [client, loadData]
  )

  const handleToggleStatus = useCallback(
    async (taskId: string, newStatus: string) => {
      await client.updateTask(taskId, { status: newStatus as 'active' | 'paused' })
      void loadData()
    },
    [client, loadData]
  )

  if (loading) {
    return (
      <Container>
        <div className="flex flex-1 items-center justify-center">
          <Spin />
        </div>
      </Container>
    )
  }

  return (
    <Container>
      <MainContainer>
        {/* Left panel: task list */}
        <MenuList>
          <div className="flex items-center justify-between">
            <SettingTitle>{t('settings.scheduledTasks.title')}</SettingTitle>
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              disabled={agents.length === 0}
              onClick={handleStartCreate}
            />
          </div>
          <div className="flex flex-col gap-1">
            {tasks.length === 0 && !creating ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  agents.length === 0 ? t('settings.scheduledTasks.noAgents') : t('settings.scheduledTasks.noTasks')
                }
                style={{ marginTop: 20 }}
              />
            ) : (
              tasks.map((task) => (
                <ListItem
                  key={task.id}
                  active={selectedTaskId === task.id && !creating}
                  title={task.name}
                  subtitle={`${getAgentName(task.agent_id)} · ${scheduleTypeConfig[task.schedule_type]?.label ?? task.schedule_type}`}
                  icon={
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${statusDotColors[task.status] ?? 'bg-gray-400'}`}
                    />
                  }
                  onClick={() => {
                    setCreating(false)
                    setSelectedTaskId(task.id)
                  }}
                />
              ))
            )}
          </div>
        </MenuList>

        {/* Right panel */}
        <RightContainer>
          {creating ? (
            <CreateForm
              agents={agents}
              channels={channels}
              onCancel={() => setCreating(false)}
              onCreate={handleCreate}
            />
          ) : selectedTask ? (
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              agentName={getAgentName(selectedTask.agent_id)}
              channels={channels}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onRun={handleRun}
              onToggleStatus={handleToggleStatus}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[var(--color-text-3)] text-sm">
              {tasks.length > 0
                ? t('settings.scheduledTasks.selectTask', 'Select a task to view details')
                : t('settings.scheduledTasks.noTasks')}
            </div>
          )}
        </RightContainer>
      </MainContainer>
    </Container>
  )
}

const Container = styled(Flex)`
  flex: 1;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  width: 100%;
  height: calc(100vh - var(--navbar-height) - 6px);
  overflow: hidden;
`

const MenuList = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  padding-bottom: 48px;
  border-right: 0.5px solid var(--color-border);
  height: calc(100vh - var(--navbar-height));
`

const RightContainer = styled.div`
  flex: 1;
  position: relative;
  display: flex;
`

export default TasksSettings
