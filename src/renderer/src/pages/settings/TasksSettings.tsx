import { PlusOutlined } from '@ant-design/icons'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAgentClient } from '@renderer/hooks/agents/useAgentClient'
import { useChannels } from '@renderer/hooks/agents/useChannels'
import { useTaskLogs } from '@renderer/hooks/agents/useTasks'
import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId, setActiveSessionIdAction } from '@renderer/store/runtime'
import type { CreateTaskRequest, ScheduledTaskEntity, TaskRunLogEntity, UpdateTaskRequest } from '@renderer/types'
import { Alert, Button, DatePicker, Empty, Input, Modal, Popconfirm, Select, Spin, Table, Tag, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { CalendarClock, Clock, ExternalLink, History, Maximize2, Pause, Play, Search, Trash2 } from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

// --------------- Types ---------------

type AgentInfo = { id: string; name: string }
type ChannelInfo = { id: string; name: string; isActive?: boolean; hasActiveChatIds?: boolean }

// --------------- Shared channel selector with warnings ---------------

const TaskChannelSelector: FC<{
  channels: ChannelInfo[]
  channelIds: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}> = ({ channels, channelIds, onChange, disabled }) => {
  const { t } = useTranslation()

  if (channels.length === 0) return null

  const hasNoChatIds = channelIds.some((id) => !channels.find((c) => c.id === id)?.hasActiveChatIds)

  return (
    <>
      <SettingDivider />
      <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <SettingRowTitle>{t('agent.cherryClaw.tasks.channels.label')}</SettingRowTitle>
        <Select
          mode="multiple"
          size="small"
          className="w-full"
          value={channelIds}
          disabled={disabled}
          onChange={onChange}
          placeholder={t('agent.cherryClaw.tasks.channels.placeholder')}
          options={channels.map((ch) => ({
            value: ch.id,
            label: (
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${ch.isActive ? 'bg-green-500' : 'bg-gray-400'}`}
                />
                {ch.name}
              </span>
            )
          }))}
        />
        {hasNoChatIds && (
          <Alert
            type="warning"
            showIcon
            message={t('agent.cherryClaw.tasks.channels.noActiveChatIds')}
            className="mt-2"
            style={{ fontSize: 12 }}
          />
        )}
      </SettingRow>
    </>
  )
}

// --------------- Task Detail (right panel) ---------------

const TaskDetail: FC<{
  task: ScheduledTaskEntity
  agents: AgentInfo[]
  channels: ChannelInfo[]
  onUpdate: (taskId: string, updates: UpdateTaskRequest) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onRun: (taskId: string) => Promise<void>
  onToggleStatus: (taskId: string, newStatus: string) => Promise<void>
}> = ({ task, agents, channels, onUpdate, onDelete, onRun, onToggleStatus }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const isCompleted = task.status === 'completed'
  const statusColors: Record<string, string> = { active: 'green', paused: 'orange', completed: 'blue' }
  const statusLabels: Record<string, string> = {
    active: t('agent.cherryClaw.tasks.status.active'),
    paused: t('agent.cherryClaw.tasks.status.paused'),
    completed: t('agent.cherryClaw.tasks.status.completed')
  }
  const scheduleTypeLabels: Record<string, string> = {
    cron: t('agent.cherryClaw.tasks.scheduleType.cron'),
    interval: t('agent.cherryClaw.tasks.scheduleType.interval'),
    once: t('agent.cherryClaw.tasks.scheduleType.once')
  }
  const agentName = agents.find((a) => a.id === task.agent_id)?.name ?? task.agent_id

  const [name, setName] = useState(task.name)
  const [prompt, setPrompt] = useState(task.prompt)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [agentId, setAgentId] = useState(task.agent_id)
  const [scheduleType, setScheduleType] = useState(task.schedule_type)
  const [scheduleValue, setScheduleValue] = useState(task.schedule_value)
  const [timeoutMinutes, setTimeoutMinutes] = useState<string>(task.timeout_minutes?.toString() ?? '')
  const [channelIds, setChannelIds] = useState<string[]>(task.channel_ids ?? [])

  useEffect(() => {
    setName(task.name)
    setPrompt(task.prompt)
    setAgentId(task.agent_id)
    setScheduleType(task.schedule_type)
    setScheduleValue(task.schedule_value)
    setTimeoutMinutes(task.timeout_minutes?.toString() ?? '')
    setChannelIds(task.channel_ids ?? [])
  }, [task])

  const saveField = useCallback(
    (updates: UpdateTaskRequest) => {
      void onUpdate(task.id, updates)
    },
    [task.id, onUpdate]
  )

  const formatDateTime = (iso: string | null | undefined) => {
    if (!iso) return '-'
    const d = new Date(iso)
    const diff = Math.abs(Date.now() - d.getTime())
    if (diff < 86400_000) {
      return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return d.toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }

  const formatScheduleValue = () => {
    if (task.schedule_type === 'cron') return task.schedule_value
    if (task.schedule_type === 'interval') return `${task.schedule_value} ${t('agent.cherryClaw.tasks.intervalUnit')}`
    if (task.schedule_type === 'once' && task.schedule_value) {
      return formatDateTime(task.schedule_value)
    }
    return task.schedule_value
  }

  return (
    <SettingContainer theme={theme}>
      {/* Header card */}
      <SettingGroup theme={theme}>
        <SettingTitle>
          <div className="flex items-center gap-2">
            <Tag color={statusColors[task.status] ?? 'default'}>{statusLabels[task.status] ?? task.status}</Tag>
            <span className="text-(--color-text-3) text-xs">{agentName}</span>
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
          <Tag color={scheduleTypeColors[task.schedule_type] ?? 'default'}>
            {scheduleTypeLabels[task.schedule_type] ?? task.schedule_type}
          </Tag>
          <span className="inline-flex items-center gap-1 text-(--color-text-3)">
            <Clock size={12} />
            {formatScheduleValue()}
          </span>
          {task.last_run && (
            <span className="inline-flex items-center gap-1 text-(--color-text-3)">
              <History size={12} />
              {t('agent.cherryClaw.tasks.lastRun')}: {formatDateTime(task.last_run)}
            </span>
          )}
          {task.next_run && (
            <span className="inline-flex items-center gap-1 text-(--color-text-3)">
              <CalendarClock size={12} />
              {t('agent.cherryClaw.tasks.nextRun')}: {formatDateTime(task.next_run)}
            </span>
          )}
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
        {agents.length > 1 && (
          <>
            <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <SettingRowTitle>{t('agent.cherryClaw.channels.bindAgent')}</SettingRowTitle>
              <Select
                size="small"
                className="w-full"
                value={agentId}
                disabled={isCompleted}
                onChange={(value) => {
                  setAgentId(value)
                  saveField({ agent_id: value })
                }}
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </SettingRow>
            <SettingDivider />
          </>
        )}
        <SettingRow style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div className="flex items-center justify-between">
            <SettingRowTitle>{t('agent.cherryClaw.tasks.prompt.label')}</SettingRowTitle>
            {!isCompleted && (
              <Tooltip title={t('agent.cherryClaw.tasks.prompt.expand')}>
                <Button
                  type="text"
                  size="small"
                  icon={<Maximize2 size={13} />}
                  onClick={() => setPromptModalOpen(true)}
                />
              </Tooltip>
            )}
          </div>
          <Input.TextArea
            size="small"
            autoSize={{ minRows: 3, maxRows: 8 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => prompt.trim() && prompt !== task.prompt && saveField({ prompt: prompt.trim() })}
            disabled={isCompleted}
          />
        </SettingRow>
        <SettingDivider />
        <div className="grid grid-cols-3 gap-3">
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
                suffix={t('agent.cherryClaw.tasks.intervalUnit')}
                disabled={isCompleted}
              />
            )}
            {scheduleType === 'once' && (
              <DatePicker
                size="small"
                showTime
                className="w-full"
                value={scheduleValue ? dayjs(scheduleValue) : null}
                onChange={(val) => {
                  if (val) {
                    const iso = val.toISOString()
                    setScheduleValue(iso)
                    saveField({ schedule_value: iso })
                  }
                }}
                disabled={isCompleted}
              />
            )}
          </div>
          <div>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.timeout.label')}</SettingRowTitle>
            <Input
              size="small"
              type="number"
              min={1}
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(e.target.value)}
              onBlur={() => {
                const val = timeoutMinutes.trim() ? parseInt(timeoutMinutes, 10) : null
                const prev = task.timeout_minutes ?? null
                if (val !== prev) saveField({ timeout_minutes: val })
              }}
              placeholder={t('agent.cherryClaw.tasks.timeout.placeholder')}
              suffix={t('agent.cherryClaw.tasks.intervalUnit')}
              disabled={isCompleted}
            />
          </div>
        </div>
        <TaskChannelSelector
          channels={channels}
          channelIds={channelIds}
          onChange={(value) => {
            setChannelIds(value)
            saveField({ channel_ids: value })
          }}
          disabled={isCompleted}
        />
      </SettingGroup>

      {/* Logs card */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('agent.cherryClaw.tasks.logs.label')}</SettingTitle>
        <SettingDivider />
        <TaskLogsInline taskId={task.id} agentId={task.agent_id} />
      </SettingGroup>

      <Modal
        title={t('agent.cherryClaw.tasks.prompt.label')}
        open={promptModalOpen}
        onCancel={() => {
          if (prompt.trim() && prompt !== task.prompt) {
            saveField({ prompt: prompt.trim() })
          }
          setPromptModalOpen(false)
        }}
        footer={null}
        width={640}>
        <Input.TextArea
          autoSize={{ minRows: 12, maxRows: 30 }}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isCompleted}
          style={{ marginTop: 8 }}
        />
      </Modal>
    </SettingContainer>
  )
}

// --------------- Inline Logs ---------------

const TaskLogsInline: FC<{ taskId: string; agentId: string }> = ({ taskId, agentId }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { logs, isLoading } = useTaskLogs(taskId)
  const [searchText, setSearchText] = useState('')

  const filteredLogs = useMemo(() => {
    if (!searchText.trim()) return logs
    const query = searchText.toLowerCase()
    return logs.filter(
      (log) =>
        log.result?.toLowerCase().includes(query) ||
        log.error?.toLowerCase().includes(query) ||
        log.status.toLowerCase().includes(query) ||
        new Date(log.run_at).toLocaleString(locale).toLowerCase().includes(query)
    )
  }, [locale, logs, searchText])

  const navigateToSession = useCallback(
    (sessionId: string) => {
      dispatch(setActiveAgentId(agentId))
      dispatch(setActiveSessionIdAction({ agentId, sessionId }))
      navigate('/agents')
    },
    [agentId, dispatch, navigate]
  )

  const columns = [
    {
      title: t('agent.cherryClaw.tasks.logs.runAt'),
      dataIndex: 'run_at',
      key: 'run_at',
      width: 160,
      render: (val: string) =>
        new Date(val).toLocaleString(undefined, {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
    },
    {
      title: t('agent.cherryClaw.tasks.logs.duration'),
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      width: 80,
      render: (val: number, record: TaskRunLogEntity) => {
        if (record.status === 'running') return '-'
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
      render: (val: string) => {
        const color = val === 'success' ? 'green' : val === 'running' ? 'processing' : 'red'
        const logStatusLabels: Record<string, string> = {
          success: t('agent.cherryClaw.tasks.logs.success'),
          running: t('agent.cherryClaw.tasks.logs.running'),
          error: t('agent.cherryClaw.tasks.logs.error')
        }
        return <Tag color={color}>{logStatusLabels[val] ?? val}</Tag>
      }
    },
    {
      title: t('agent.cherryClaw.tasks.logs.result'),
      dataIndex: 'result',
      key: 'result',
      ellipsis: true,
      render: (val: string | null, record: TaskRunLogEntity) => {
        const text =
          record.status === 'running'
            ? t('agent.cherryClaw.tasks.logs.running', 'Running...')
            : record.status === 'error'
              ? record.error
              : (val ?? '-')
        const hasSession = !!record.session_id

        return (
          <div className="flex items-center gap-1">
            <span
              className={record.status === 'error' ? 'text-red-500' : ''}
              style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {text}
            </span>
            {hasSession && (
              <Tooltip title={t('agent.cherryClaw.tasks.logs.viewSession', 'View session')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ExternalLink size={12} />}
                  style={{ flexShrink: 0 }}
                  onClick={() => navigateToSession(record.session_id!)}
                />
              </Tooltip>
            )}
          </div>
        )
      }
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

  return (
    <div className="flex flex-col gap-2">
      <Input
        size="small"
        prefix={<Search size={12} className="text-(--color-text-3)" />}
        placeholder={t('agent.cherryClaw.tasks.logs.search', 'Search logs...')}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        allowClear
      />
      <Table
        dataSource={filteredLogs}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ y: 300 }}
      />
    </div>
  )
}

// --------------- Schedule type config ---------------

const scheduleTypeColors: Record<string, string> = {
  cron: 'purple',
  interval: 'blue',
  once: 'orange'
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
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>('interval')
  const [scheduleValue, setScheduleValue] = useState('')
  const [timeoutMinutes, setTimeoutMinutes] = useState('')
  const [channelIds, setChannelIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const isValid = agentId && name.trim() && prompt.trim() && scheduleValue.trim()

  const handleCreate = useCallback(async () => {
    if (!agentId || !name.trim() || !prompt.trim() || !scheduleValue.trim()) return
    setSaving(true)
    try {
      const timeout = timeoutMinutes.trim() ? parseInt(timeoutMinutes, 10) : null
      await onCreate(agentId, {
        name: name.trim(),
        prompt: prompt.trim(),
        schedule_type: scheduleType,
        schedule_value: scheduleValue.trim(),
        timeout_minutes: timeout && timeout > 0 ? timeout : undefined,
        channel_ids: channelIds.length > 0 ? channelIds : undefined
      })
    } finally {
      setSaving(false)
    }
  }, [agentId, name, prompt, scheduleType, scheduleValue, timeoutMinutes, channelIds, onCreate])

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
          <div className="flex items-center justify-between">
            <SettingRowTitle>{t('agent.cherryClaw.tasks.prompt.label')}</SettingRowTitle>
            <Tooltip title={t('agent.cherryClaw.tasks.prompt.expand')}>
              <Button
                type="text"
                size="small"
                icon={<Maximize2 size={13} />}
                onClick={() => setPromptModalOpen(true)}
              />
            </Tooltip>
          </div>
          <Input.TextArea
            size="small"
            autoSize={{ minRows: 3, maxRows: 8 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('agent.cherryClaw.tasks.prompt.placeholder')}
          />
        </SettingRow>
        <SettingDivider />

        <Modal
          title={t('agent.cherryClaw.tasks.prompt.label')}
          open={promptModalOpen}
          onCancel={() => setPromptModalOpen(false)}
          footer={null}
          width={640}>
          <Input.TextArea
            autoSize={{ minRows: 12, maxRows: 30 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('agent.cherryClaw.tasks.prompt.placeholder')}
            style={{ marginTop: 8 }}
          />
        </Modal>

        <div className="grid grid-cols-3 gap-3">
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
              <DatePicker
                size="small"
                showTime
                className="w-full"
                value={scheduleValue ? dayjs(scheduleValue) : null}
                onChange={(val) => {
                  if (val) {
                    setScheduleValue(val.toISOString())
                  }
                }}
              />
            )}
          </div>
          <div>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.timeout.label')}</SettingRowTitle>
            <Input
              size="small"
              type="number"
              min={1}
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(e.target.value)}
              placeholder={t('agent.cherryClaw.tasks.timeout.placeholder')}
              suffix="min"
            />
          </div>
        </div>
        <TaskChannelSelector channels={channels} channelIds={channelIds} onChange={setChannelIds} />
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
    () =>
      rawChannels.map((ch: any) => ({
        id: ch.id,
        name: ch.name || ch.type,
        isActive: ch.is_active === true || ch.isActive === true,
        hasActiveChatIds:
          ((ch.config?.allowed_chat_ids as string[]) ?? []).length > 0 ||
          ((ch.config?.allowed_channel_ids as string[]) ?? []).length > 0 ||
          ((ch.active_chat_ids ?? ch.activeChatIds ?? []) as string[]).length > 0
      })),
    [rawChannels]
  )

  const loadData = useCallback(async () => {
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        client.listTasks({ limit: 200 }),
        client.listAgents({ limit: 100 })
      ])
      setTasks(tasksRes.data)
      setAgents(
        agentsRes.data
          .filter((a) => {
            return a.configuration?.soul_enabled === true || a.configuration?.permission_mode === 'bypassPermissions'
          })
          .map((a) => ({ id: a.id, name: a.name ?? a.id }))
      )
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Auto-select the first task when data is loaded and nothing is selected
  useEffect(() => {
    if (!loading && !selectedTaskId && !creating && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id)
    }
  }, [loading, selectedTaskId, creating, tasks])

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId])

  const getAgentName = useCallback((agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId, [agents])
  const scheduleTypeLabelsMap: Record<string, string> = {
    cron: t('agent.cherryClaw.tasks.scheduleType.cron'),
    interval: t('agent.cherryClaw.tasks.scheduleType.interval'),
    once: t('agent.cherryClaw.tasks.scheduleType.once')
  }

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
      // Refresh task logs SWR cache so the logs list updates
      const logsKey = client.taskPaths.logs(taskId)
      void mutate(logsKey)
      // Task runs asynchronously — refresh again after a delay to capture completion
      setTimeout(() => {
        void mutate(logsKey)
        void loadData()
      }, 1000)
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
      <div className="flex flex-1">
        <div className="flex flex-1 items-center justify-center">
          <Spin />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1">
      <div
        className="flex w-full flex-1 flex-row overflow-hidden"
        style={{ height: 'calc(100vh - var(--navbar-height) - 6px)' }}>
        {/* Left panel: task list */}
        <Scrollbar
          className="flex flex-col gap-1.25 border-(--color-border) border-r-[0.5px] p-3 pb-12"
          style={{ width: 'var(--settings-width)', height: 'calc(100vh - var(--navbar-height))' }}>
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
                  <div className="flex flex-col gap-2">
                    <span>
                      {agents.length === 0
                        ? t('settings.scheduledTasks.noAgents')
                        : t('settings.scheduledTasks.noTasks')}
                    </span>
                    {agents.length === 0 && (
                      <span className="text-(--color-text-3) text-xs">{t('settings.scheduledTasks.noAgentsTip')}</span>
                    )}
                  </div>
                }
                style={{ marginTop: 20 }}
              />
            ) : (
              tasks.map((task) => (
                <ListItem
                  key={task.id}
                  active={selectedTaskId === task.id && !creating}
                  title={task.name}
                  subtitle={`${getAgentName(task.agent_id)} · ${scheduleTypeLabelsMap[task.schedule_type] ?? task.schedule_type}`}
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
        </Scrollbar>

        {/* Right panel */}
        <div className="relative flex flex-1">
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
              agents={agents}
              channels={channels}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onRun={handleRun}
              onToggleStatus={handleToggleStatus}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-(--color-text-3) text-sm">
              {tasks.length > 0
                ? t('settings.scheduledTasks.selectTask', 'Select a task to view details')
                : t('settings.scheduledTasks.noTasks')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TasksSettings
