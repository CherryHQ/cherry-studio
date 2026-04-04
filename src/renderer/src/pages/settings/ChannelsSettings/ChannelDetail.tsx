import { DeleteOutlined, EditOutlined, FileTextOutlined, PlusOutlined } from '@ant-design/icons'
import CopyButton from '@renderer/components/CopyButton'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useChannels } from '@renderer/hooks/agents/useChannels'
import { isSoulModeEnabled } from '@renderer/pages/settings/AgentSettings/shared'
import type { AgentConfiguration } from '@renderer/types'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { Alert, Button, Empty, Input, Modal, Popconfirm, Select, Spin, Switch, Tag, Tooltip } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingTitle } from '..'
import { getFormForType } from './ChannelForms'
import type { AvailableChannel, ChannelData } from './channelTypes'

// --------------- Types ---------------

type LogEntry = { timestamp: number; level: string; message: string; channelId: string }
type StatusEvent = { channelId: string; connected: boolean; error?: string }

// --------------- Helpers ---------------

function truncateId(s: string, prefixLen = 7, suffixLen = 3): string {
  if (s.length <= prefixLen + suffixLen + 3) return s
  return `${s.slice(0, prefixLen)}...${s.slice(-suffixLen)}`
}

function getChannelSummary(channel: ChannelData): string {
  const cfg = channel.config
  const chatIds = (cfg.allowed_chat_ids as string[]) ?? []
  const parts: string[] = []

  switch (channel.type) {
    case 'feishu': {
      if (cfg.app_id) parts.push(truncateId(cfg.app_id as string))
      const domain = cfg.domain as string
      parts.push(domain === 'lark' ? 'Lark (International)' : 'Feishu (China)')
      break
    }
    case 'telegram':
      if (cfg.bot_token) parts.push(`Token: ${truncateId(cfg.bot_token as string)}`)
      if (chatIds.length > 0) parts.push(`${chatIds.length} chat IDs`)
      break
    case 'qq':
      if (cfg.app_id) parts.push(truncateId(cfg.app_id as string))
      if (chatIds.length > 0) parts.push(`${chatIds.length} chat IDs`)
      break
    case 'discord': {
      if (cfg.bot_token) parts.push(`Token: ${truncateId(cfg.bot_token as string)}`)
      const channelIds = (cfg.allowed_channel_ids as string[]) ?? []
      if (channelIds.length > 0) parts.push(`${channelIds.length} channel IDs`)
      break
    }
    case 'slack': {
      if (cfg.bot_token) parts.push(`Token: ${truncateId(cfg.bot_token as string)}`)
      const slackChannelIds = (cfg.allowed_channel_ids as string[]) ?? []
      if (slackChannelIds.length > 0) parts.push(`${slackChannelIds.length} channel IDs`)
      break
    }
    case 'wechat':
      break
  }
  return parts.join(' \u00b7 ')
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  error: '#ff4d4f',
  warn: '#faad14',
  info: '#1677ff',
  debug: '#8c8c8c'
}

// --------------- Log Modal ---------------

const ChannelLogModal: FC<{
  open: boolean
  channelId: string | null
  channelName: string
  onClose: () => void
}> = ({ open, channelId, channelName, onClose }) => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !channelId) {
      setLogs([])
      return
    }

    // Load existing logs
    window.api.channel
      .getLogs(channelId)
      .then(setLogs)
      .catch(() => {})

    // Subscribe to real-time logs
    const unsub = window.api.channel.onLog((entry) => {
      if (entry.channelId === channelId) {
        setLogs((prev) => [...prev.slice(-199), entry])
      }
    })

    return unsub
  }, [open, channelId])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const logsText = useMemo(
    () => logs.map((e) => `${formatTime(e.timestamp)} [${e.level.toUpperCase()}] ${e.message}`).join('\n'),
    [logs]
  )

  return (
    <Modal
      open={open}
      title={
        <div className="flex items-center gap-2">
          <span>{`${channelName} — ${t('agent.cherryClaw.channels.logs')}`}</span>
          {logs.length > 0 && <CopyButton textToCopy={logsText} size={14} />}
        </div>
      }
      footer={null}
      onCancel={onClose}
      width={600}
      destroyOnHidden
      transitionName="animation-move-down"
      centered>
      <div className="max-h-100 overflow-y-auto rounded-[6px] bg-(--color-background-soft) p-2 font-mono text-[11px] leading-[1.6]">
        {logs.length === 0 && (
          <div className="py-8 text-center text-foreground-400 text-xs">{t('agent.cherryClaw.channels.noLogs')}</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2 whitespace-pre-wrap py-px">
            <span className="shrink-0 text-foreground-400">{formatTime(entry.timestamp)}</span>
            <span style={{ color: LOG_LEVEL_COLORS[entry.level] ?? '#8c8c8c', fontWeight: 500 }}>
              [{entry.level.toUpperCase()}]
            </span>
            <span className="break-all">{entry.message}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </Modal>
  )
}

// --------------- Edit Modal ---------------

type EditModalProps = {
  open: boolean
  channel: ChannelData | null
  agents: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (id: string, updates: Partial<ChannelData>) => void
  onDelete: (id: string) => void
}

const ChannelEditModal: FC<
  EditModalProps & { agentEntities?: Array<{ id: string; configuration?: AgentConfiguration }> }
> = ({ open, channel, agents, onClose, onSave, onDelete, agentEntities }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState<string | null>(null)

  useEffect(() => {
    if (channel) {
      setName(channel.name)
      setAgentId(channel.agentId ?? null)
    }
  }, [channel])

  const selectedAgent = agentEntities?.find((a) => a.id === agentId)
  const showSoulModeWarning = agentId && selectedAgent && !isSoulModeEnabled(selectedAgent.configuration)

  const handleNameBlur = useCallback(() => {
    if (channel && name.trim() && name.trim() !== channel.name) {
      onSave(channel.id, { name: name.trim() })
    }
  }, [channel, name, onSave])

  const handleAgentChange = useCallback(
    (value: string | null) => {
      setAgentId(value)
      if (channel) {
        onSave(channel.id, { agentId: value })
      }
    },
    [channel, onSave]
  )

  const handleUpdate = useCallback(
    (updates: Partial<ChannelData>) => {
      if (channel) onSave(channel.id, updates)
    },
    [channel, onSave]
  )

  const FormComponent = channel ? getFormForType(channel.type) : null

  return (
    <Modal
      open={open}
      title={channel?.name}
      footer={null}
      onCancel={onClose}
      width={500}
      destroyOnHidden
      centered
      transitionName="animation-move-down">
      {channel && (
        <div className="flex flex-col gap-4 py-2">
          <div>
            <label className="mb-1 block font-medium text-xs">{t('common.name')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={handleNameBlur} size="small" />
          </div>
          <div>
            <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.bindAgent')}</label>
            <Select
              value={agentId}
              onChange={handleAgentChange}
              size="small"
              className="w-full"
              allowClear
              placeholder={t('agent.cherryClaw.channels.selectAgent')}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
            />
            {showSoulModeWarning && (
              <Alert
                type="warning"
                showIcon
                message={t('agent.cherryClaw.channels.soulModeRequired')}
                className="mt-2"
                style={{ fontSize: 12 }}
              />
            )}
          </div>
          {FormComponent && (
            <FormComponent channel={channel} onConfigChange={handleUpdate} onRemove={() => onDelete(channel.id)} />
          )}
        </div>
      )}
    </Modal>
  )
}

// --------------- Instance Row ---------------

const ChannelInstanceRow: FC<{
  channel: ChannelData
  agents: Array<{ id: string; name: string }>
  connectionStatus: StatusEvent | undefined
  onEdit: () => void
  onDelete: () => void
  onToggle: (active: boolean) => void
  onShowLogs: () => void
}> = ({ channel, agents, connectionStatus, onEdit, onDelete, onToggle, onShowLogs }) => {
  const { t } = useTranslation()
  const summary = getChannelSummary(channel)
  const agentName = agents.find((a) => a.id === channel.agentId)?.name

  const isConnected = connectionStatus?.connected ?? false
  const hasError = connectionStatus?.error

  let statusColor = 'bg-gray-400' // inactive or unknown
  let statusTag: React.ReactNode = null
  if (channel.isActive) {
    if (isConnected) {
      statusColor = 'bg-green-500'
      statusTag = (
        <Tag color="success" className="text-[10px] leading-3.5">
          {t('agent.cherryClaw.channels.connected')}
        </Tag>
      )
    } else if (hasError) {
      statusColor = 'bg-red-500'
      statusTag = (
        <Tooltip title={hasError}>
          <Tag color="error" className="text-[10px] leading-3.5">
            {t('agent.cherryClaw.channels.error')}
          </Tag>
        </Tooltip>
      )
    }
  }

  return (
    <div className="flex items-center gap-3 border-(--color-border) border-b-[0.5px] px-1 py-2.5 last:border-b-0">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium text-sm">
          {channel.name}
          {statusTag}
        </div>
        <div className="truncate text-foreground-400 text-xs">
          {agentName && <span className="mr-2 text-blue-400">{agentName}</span>}
          {summary}
        </div>
      </div>
      <Tooltip title={t('agent.cherryClaw.channels.logs')}>
        <Button type="text" size="small" icon={<FileTextOutlined />} onClick={onShowLogs} />
      </Tooltip>
      <Tooltip title={t('common.edit')}>
        <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} />
      </Tooltip>
      <Popconfirm
        title={t('agent.cherryClaw.channels.deleteConfirm', { name: channel.name })}
        onConfirm={onDelete}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}>
        <Tooltip title={t('common.delete')}>
          <Button type="text" size="small" icon={<DeleteOutlined />} danger />
        </Tooltip>
      </Popconfirm>
      <Switch checked={channel.isActive} size="small" onChange={onToggle} />
    </div>
  )
}

// --------------- Main Detail ---------------

type ChannelDetailProps = {
  channelDef: AvailableChannel
}

const ChannelDetail: FC<ChannelDetailProps> = ({ channelDef }) => {
  const { t } = useTranslation()

  // SWR-managed remote data
  const { channels, isLoading, mutate, createChannel, updateChannel, deleteChannel } = useChannels(channelDef.type)
  const { agents: agentList } = useAgents()
  const { agents, agentEntities } = useMemo(() => {
    const list = agentList ?? []
    return {
      agents: list.map((a) => ({ id: a.id, name: a.name ?? a.id })),
      agentEntities: list.map((a) => ({ id: a.id, configuration: a.configuration }))
    }
  }, [agentList])

  const channelList = channels ?? []

  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const editingChannel = channelList.find((ch) => ch.id === editingChannelId) ?? null

  // Connection status tracking
  const [statuses, setStatuses] = useState<Map<string, StatusEvent>>(new Map())

  // Log modal
  const [logChannel, setLogChannel] = useState<{ id: string; name: string } | null>(null)

  // Fetch initial statuses + subscribe to real-time changes
  useEffect(() => {
    window.api.channel
      .getStatuses()
      .then((list) => {
        setStatuses(new Map(list.map((s) => [s.channelId, s])))
      })
      .catch(() => {})

    const unsub = window.api.channel.onStatusChange((status) => {
      setStatuses((prev) => {
        // When a channel transitions to connected, revalidate SWR
        // (e.g. after QR registration saves credentials in main process)
        if (status.connected && !prev.get(status.channelId)?.connected) {
          void mutate()
        }
        const next = new Map(prev)
        next.set(status.channelId, status)
        return next
      })
    })
    return unsub
  }, [mutate])

  const handleAdd = useCallback(async () => {
    const existingCount = channels?.length ?? 0
    try {
      const newChannel = await createChannel({
        type: channelDef.type,
        name: existingCount > 0 ? `${channelDef.name} ${existingCount + 1}` : channelDef.name,
        config: channelDef.defaultConfig,
        is_active: true
      })
      setEditingChannelId(newChannel.id)
    } catch {
      // ignore
    }
  }, [channels?.length, createChannel, channelDef])

  const handleSave = useCallback(
    async (channelId: string, updates: Partial<ChannelData>) => {
      try {
        const apiUpdates: Record<string, unknown> = {}
        if (updates.name !== undefined) apiUpdates.name = updates.name
        if (updates.agentId !== undefined) apiUpdates.agent_id = updates.agentId
        if (updates.config !== undefined) apiUpdates.config = updates.config
        if (updates.isActive !== undefined) apiUpdates.is_active = updates.isActive
        if (updates.permissionMode !== undefined) apiUpdates.permission_mode = updates.permissionMode

        await updateChannel(channelId, apiUpdates)
      } catch {
        // ignore
      }
    },
    [updateChannel]
  )

  const handleDelete = useCallback(
    async (channelId: string) => {
      try {
        await deleteChannel(channelId)
        setEditingChannelId((prev) => (prev === channelId ? null : prev))
      } catch {
        // ignore
      }
    },
    [deleteChannel]
  )

  const handleToggle = useCallback(
    async (channelId: string, active: boolean) => {
      await handleSave(channelId, { isActive: active })
    },
    [handleSave]
  )

  if (isLoading) {
    return (
      <Scrollbar
        className="flex flex-1 flex-col items-center justify-center px-5 py-4"
        style={{ height: 'calc(100vh - var(--navbar-height))' }}>
        <Spin />
      </Scrollbar>
    )
  }

  const icon = getChannelTypeIcon(channelDef.type)

  return (
    <Scrollbar className="flex flex-1 flex-col px-5 py-4" style={{ height: 'calc(100vh - var(--navbar-height))' }}>
      <div className="mb-1">
        <SettingTitle>
          <div className="flex items-center gap-2">
            {icon && <img src={icon} className="h-5 w-5 rounded-sm object-contain" />}
            <span>{channelDef.name}</span>
          </div>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            disabled={!channelDef.available}
            onClick={handleAdd}>
            {t('agent.cherryClaw.channels.add')}
          </Button>
        </SettingTitle>
        <p className="mt-1.5 mb-0 text-(--color-text-3) text-xs">
          {channelDef.available ? t(channelDef.description) : t('agent.cherryClaw.channels.comingSoon')}
        </p>
      </div>
      <SettingDivider style={{ margin: '0 0 4px 0' }} />
      <div className="flex flex-col">
        {channelList.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('agent.cherryClaw.channels.noInstances', { type: channelDef.name })}
          />
        )}
        {channelList.map((ch) => (
          <ChannelInstanceRow
            key={ch.id}
            channel={ch}
            agents={agents}
            connectionStatus={statuses.get(ch.id)}
            onEdit={() => setEditingChannelId(ch.id)}
            onDelete={() => handleDelete(ch.id)}
            onToggle={(active) => handleToggle(ch.id, active)}
            onShowLogs={() => setLogChannel({ id: ch.id, name: ch.name })}
          />
        ))}
      </div>

      <ChannelEditModal
        open={!!editingChannel}
        channel={editingChannel}
        agents={agents}
        agentEntities={agentEntities}
        onClose={() => setEditingChannelId(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      <ChannelLogModal
        open={!!logChannel}
        channelId={logChannel?.id ?? null}
        channelName={logChannel?.name ?? ''}
        onClose={() => setLogChannel(null)}
      />
    </Scrollbar>
  )
}

export default ChannelDetail
