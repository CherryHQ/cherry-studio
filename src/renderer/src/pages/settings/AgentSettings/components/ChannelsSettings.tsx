import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type {
  CherryClawChannel,
  CherryClawConfiguration,
  FeishuChannelConfig,
  FeishuDomain,
  PermissionMode
} from '@renderer/types'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { Button, Checkbox, Input, Modal, Popconfirm, Select, Switch, Tooltip } from 'antd'
import { ChevronDown } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { ReactNode } from 'react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

// --------------- Channel catalog registry ---------------

type AvailableChannel = {
  type: 'telegram' | 'feishu' | 'qq' | 'wechat'
  name: string
  description: string
  available: boolean
  defaultConfig: CherryClawChannel['config']
}

const AVAILABLE_CHANNELS: AvailableChannel[] = [
  {
    type: 'feishu',
    name: 'Feishu',
    description: 'agent.cherryClaw.channels.feishu.description',
    available: true,
    defaultConfig: {
      app_id: '',
      app_secret: '',
      encrypt_key: '',
      verification_token: '',
      allowed_chat_ids: [],
      domain: 'feishu'
    }
  },
  {
    type: 'telegram',
    name: 'Telegram',
    description: 'agent.cherryClaw.channels.telegram.description',
    available: true,
    defaultConfig: { bot_token: '', allowed_chat_ids: [] }
  },
  {
    type: 'qq',
    name: 'QQ',
    description: 'agent.cherryClaw.channels.qq.description',
    available: true,
    defaultConfig: { app_id: '', client_secret: '', allowed_chat_ids: [] }
  },
  {
    type: 'wechat',
    name: 'WeChat',
    description: 'agent.cherryClaw.channels.wechat.description',
    available: true,
    defaultConfig: { token_path: '', allowed_chat_ids: [] }
  }
]

// --------------- Helpers ---------------

function truncateId(s: string, prefixLen = 7, suffixLen = 3): string {
  if (s.length <= prefixLen + suffixLen + 3) return s
  return `${s.slice(0, prefixLen)}...${s.slice(-suffixLen)}`
}

function hasRequiredCredentials(channel: CherryClawChannel): boolean {
  const cfg = channel.config as unknown as Record<string, unknown>
  switch (channel.type) {
    case 'feishu':
      return !!(cfg.app_id && cfg.app_secret)
    case 'telegram':
      return !!cfg.bot_token
    case 'qq':
      return !!(cfg.app_id && cfg.client_secret)
    case 'wechat':
      return true // credential check is async; assume ok if enabled
    default:
      return false
  }
}

function getChannelSummary(channel: CherryClawChannel): string {
  const cfg = channel.config as unknown as Record<string, unknown>
  const chatIds = (cfg.allowed_chat_ids as string[]) ?? []
  const parts: string[] = []

  switch (channel.type) {
    case 'feishu': {
      if (cfg.app_id) parts.push(truncateId(cfg.app_id as string))
      const domain = (cfg as unknown as FeishuChannelConfig).domain
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
    case 'wechat':
      break
  }
  return parts.join(' \u00b7 ')
}

// --------------- Shared form components ---------------

type ChannelCardProps = {
  channel: CherryClawChannel
  onConfigChange: (updates: Partial<CherryClawChannel>) => void
}

const PERMISSION_MODE_OPTIONS: Array<{ value: PermissionMode | ''; labelKey: string }> = [
  { value: '', labelKey: 'agent.cherryClaw.channels.security.inheritFromAgent' },
  { value: 'default', labelKey: 'agent.settings.tooling.permissionMode.default.title' },
  { value: 'acceptEdits', labelKey: 'agent.settings.tooling.permissionMode.acceptEdits.title' },
  { value: 'bypassPermissions', labelKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title' },
  { value: 'plan', labelKey: 'agent.settings.tooling.permissionMode.plan.title' }
]

const ChannelPermissionMode: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1">
      <label className="font-medium text-xs">{t('agent.cherryClaw.channels.security.permissionMode')}</label>
      <Select
        value={channel.permission_mode ?? ''}
        onChange={(value) => onConfigChange({ permission_mode: value === '' ? undefined : (value as PermissionMode) })}
        size="small"
        className="w-full"
        options={PERMISSION_MODE_OPTIONS.map((opt) => ({
          value: opt.value,
          label: t(opt.labelKey)
        }))}
      />
      <span className="text-gray-400 text-xs">{t('agent.cherryClaw.channels.security.permissionModeHint')}</span>
    </div>
  )
}

const NotifyCheckbox: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={channel.is_notify_receiver}
        onChange={(e) => onConfigChange({ is_notify_receiver: e.target.checked })}
      />
      <div>
        <span className="text-sm">{t('agent.cherryClaw.channels.notifyReceiver')}</span>
        <span className="block text-gray-400 text-xs">{t('agent.cherryClaw.channels.notifyReceiverHint')}</span>
      </div>
    </div>
  )
}

// --------------- Shared field-based config form ---------------

type FieldDef = {
  key: string
  label: string
  placeholder: string
  secret?: boolean
  span?: 1 | 2
}

type ChatIdsConfig = {
  label: string
  placeholder: string
  hint: string
  extraHint?: string
  fullWidth?: boolean
}

type ChannelFieldsCardProps = ChannelCardProps & {
  fields: FieldDef[]
  chatIds: ChatIdsConfig
  extraContent?: ReactNode
}

const ChannelFieldsCard: FC<ChannelFieldsCardProps> = ({
  channel,
  onConfigChange,
  fields,
  chatIds: chatIdsConfig,
  extraContent
}) => {
  const cfg = channel.config as unknown as Record<string, unknown>

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, (cfg[f.key] as string) ?? '']))
  )
  const [chatIds, setChatIds] = useState(((cfg.allowed_chat_ids as string[]) ?? []).join(', '))

  useEffect(() => {
    setFieldValues(Object.fromEntries(fields.map((f) => [f.key, (cfg[f.key] as string) ?? ''])))
    setChatIds(((cfg.allowed_chat_ids as string[]) ?? []).join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fields.map((f) => cfg[f.key])), cfg.allowed_chat_ids])

  const saveField = useCallback(
    (key: string, value: string) => {
      const trimmed = value.trim()
      if (trimmed !== ((cfg[key] as string) ?? '')) {
        onConfigChange({ config: { ...cfg, [key]: trimmed } as CherryClawChannel['config'] })
      }
    },
    [cfg, onConfigChange]
  )

  const saveChatIds = useCallback(() => {
    const ids = chatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (JSON.stringify(ids) !== JSON.stringify((cfg.allowed_chat_ids as string[]) ?? [])) {
      onConfigChange({ config: { ...cfg, allowed_chat_ids: ids } as CherryClawChannel['config'] })
    }
  }, [chatIds, cfg, onConfigChange])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key} className={field.span === 2 ? 'col-span-2' : ''}>
            <label className="mb-1 block font-medium text-xs">{field.label}</label>
            {field.secret ? (
              <Input.Password
                value={fieldValues[field.key] ?? ''}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={() => saveField(field.key, fieldValues[field.key] ?? '')}
                placeholder={field.placeholder}
                size="small"
              />
            ) : (
              <Input
                value={fieldValues[field.key] ?? ''}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={() => saveField(field.key, fieldValues[field.key] ?? '')}
                placeholder={field.placeholder}
                size="small"
              />
            )}
          </div>
        ))}
        {extraContent}
        <div className={chatIdsConfig.fullWidth ? 'col-span-2' : ''}>
          <label className="mb-1 block font-medium text-xs">{chatIdsConfig.label}</label>
          <Input
            value={chatIds}
            onChange={(e) => setChatIds(e.target.value)}
            onBlur={saveChatIds}
            placeholder={chatIdsConfig.placeholder}
            size="small"
          />
          <span className="mt-1 block text-gray-400 text-xs">{chatIdsConfig.hint}</span>
          {chatIdsConfig.extraHint && (
            <span className="mt-1 block text-blue-400 text-xs">{chatIdsConfig.extraHint}</span>
          )}
        </div>
      </div>
      <ChannelPermissionMode channel={channel} onConfigChange={onConfigChange} />
      <NotifyCheckbox channel={channel} onConfigChange={onConfigChange} />
    </div>
  )
}

// --------------- Type-specific config forms (used inside edit modal) ---------------

const TelegramChannelForm: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsCard
      channel={channel}
      onConfigChange={onConfigChange}
      fields={[
        {
          key: 'bot_token',
          label: t('agent.cherryClaw.channels.telegram.botToken'),
          placeholder: t('agent.cherryClaw.channels.telegram.botTokenPlaceholder'),
          secret: true
        }
      ]}
      chatIds={{
        label: t('agent.cherryClaw.channels.telegram.chatIds'),
        placeholder: t('agent.cherryClaw.channels.telegram.chatIdsPlaceholder'),
        hint: t('agent.cherryClaw.channels.telegram.chatIdsHint')
      }}
    />
  )
}

const FeishuDomainSelector: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  const cfg = channel.config as FeishuChannelConfig
  const handleDomainChange = useCallback(
    (value: FeishuDomain) => {
      onConfigChange({ config: { ...cfg, domain: value } })
    },
    [cfg, onConfigChange]
  )
  return (
    <div>
      <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.feishu.domain')}</label>
      <Select
        value={cfg.domain ?? 'feishu'}
        onChange={handleDomainChange}
        size="small"
        className="w-full"
        options={[
          { value: 'feishu', label: t('agent.cherryClaw.channels.feishu.domainFeishu') },
          { value: 'lark', label: t('agent.cherryClaw.channels.feishu.domainLark') }
        ]}
      />
    </div>
  )
}

type FeishuStatus = 'idle' | 'pending' | 'confirmed' | 'expired' | 'disconnected'

const FeishuChannelForm: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  const cfg = channel.config as FeishuChannelConfig
  const hasCredentials = !!(cfg.app_id && cfg.app_secret)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<FeishuStatus>(hasCredentials ? 'confirmed' : 'idle')

  useEffect(() => {
    const cleanup = window.api.feishu.onQrLogin((data) => {
      if (data.channelId !== channel.id) return
      if (data.status === 'confirmed' && data.appId && data.appSecret) {
        setQrUrl(null)
        setStatus('confirmed')
        onConfigChange({ config: { ...cfg, app_id: data.appId, app_secret: data.appSecret } })
      } else if (data.status === 'expired') {
        setQrUrl(null)
        setStatus('expired')
      } else if (data.status === 'disconnected') {
        setStatus('disconnected')
      } else if (data.url) {
        setQrUrl(data.url)
        setStatus('pending')
      }
    })
    return cleanup
  }, [channel.id, cfg, onConfigChange])

  return (
    <div className="flex flex-col gap-3">
      {/* QR status */}
      {!hasCredentials && (
        <div className="flex items-center gap-2">
          {status === 'pending' && (
            <span className="text-blue-400 text-xs">{t('agent.cherryClaw.channels.feishu.qrHint')}</span>
          )}
          {status === 'expired' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              <span className="text-red-500 text-xs">{t('agent.cherryClaw.channels.feishu.qrExpired')}</span>
            </>
          )}
          {status === 'idle' && (
            <span className="text-blue-400 text-xs">{t('agent.cherryClaw.channels.feishu.loginHint')}</span>
          )}
        </div>
      )}
      {hasCredentials && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          <span className="text-green-600 text-xs">{t('agent.cherryClaw.channels.feishu.connected')}</span>
        </div>
      )}

      <ChannelFieldsCard
        channel={channel}
        onConfigChange={onConfigChange}
        fields={[
          {
            key: 'app_id',
            label: t('agent.cherryClaw.channels.feishu.appId'),
            placeholder: t('agent.cherryClaw.channels.feishu.appIdPlaceholder')
          },
          {
            key: 'app_secret',
            label: t('agent.cherryClaw.channels.feishu.appSecret'),
            placeholder: t('agent.cherryClaw.channels.feishu.appSecretPlaceholder'),
            secret: true
          },
          {
            key: 'encrypt_key',
            label: t('agent.cherryClaw.channels.feishu.encryptKey'),
            placeholder: t('agent.cherryClaw.channels.feishu.encryptKeyPlaceholder'),
            secret: true
          },
          {
            key: 'verification_token',
            label: t('agent.cherryClaw.channels.feishu.verificationToken'),
            placeholder: t('agent.cherryClaw.channels.feishu.verificationTokenPlaceholder'),
            secret: true
          }
        ]}
        extraContent={<FeishuDomainSelector channel={channel} onConfigChange={onConfigChange} />}
        chatIds={{
          label: t('agent.cherryClaw.channels.feishu.chatIds'),
          placeholder: t('agent.cherryClaw.channels.feishu.chatIdsPlaceholder'),
          hint: t('agent.cherryClaw.channels.feishu.chatIdsHint')
        }}
      />

      {/* QR Code Modal */}
      <Modal
        open={!!qrUrl}
        title={t('agent.cherryClaw.channels.feishu.qrTitle')}
        footer={null}
        onCancel={() => {
          setQrUrl(null)
          if (status === 'pending') setStatus('idle')
        }}
        centered
        width={360}>
        <div className="flex flex-col items-center gap-4 py-4">
          {qrUrl && <QRCodeSVG value={qrUrl} size={240} level="M" />}
          <span className="text-center text-foreground-500 text-xs">
            {t('agent.cherryClaw.channels.feishu.qrScanHint')}
          </span>
        </div>
      </Modal>
    </div>
  )
}

const QQChannelForm: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsCard
      channel={channel}
      onConfigChange={onConfigChange}
      fields={[
        {
          key: 'app_id',
          label: t('agent.cherryClaw.channels.qq.appId'),
          placeholder: t('agent.cherryClaw.channels.qq.appIdPlaceholder')
        },
        {
          key: 'client_secret',
          label: t('agent.cherryClaw.channels.qq.clientSecret'),
          placeholder: t('agent.cherryClaw.channels.qq.clientSecretPlaceholder'),
          secret: true
        }
      ]}
      chatIds={{
        label: t('agent.cherryClaw.channels.qq.chatIds'),
        placeholder: t('agent.cherryClaw.channels.qq.chatIdsPlaceholder'),
        hint: t('agent.cherryClaw.channels.qq.chatIdsHint'),
        extraHint: t('agent.cherryClaw.channels.qq.whoamiTip'),
        fullWidth: true
      }}
    />
  )
}

type WeChatStatus = 'idle' | 'pending' | 'confirmed' | 'disconnected'

const WeChatChannelForm: FC<ChannelCardProps & { onRemove?: () => void }> = ({ channel, onConfigChange, onRemove }) => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<WeChatStatus>('idle')
  const [loginUserId, setLoginUserId] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  useEffect(() => {
    void window.api.wechat.hasCredentials(channel.id).then((result) => {
      if (result.exists) {
        setStatus('confirmed')
        if (result.userId) setLoginUserId(result.userId)
      }
    })
  }, [channel.id])

  useEffect(() => {
    const cleanup = window.api.wechat.onQrLogin((data) => {
      if (data.channelId !== channel.id) return
      if (data.status === 'confirmed') {
        setQrUrl(null)
        setStatus('confirmed')
        if (data.userId) setLoginUserId(data.userId)
      } else if (data.status === 'expired') {
        setQrUrl(null)
      } else if (data.status === 'disconnected') {
        setStatus('disconnected')
        setLoginUserId(null)
      } else if (data.url) {
        setQrUrl(data.url)
        setStatus('pending')
      }
    })
    return cleanup
  }, [channel.id])

  return (
    <div className="flex flex-col gap-3">
      {/* Status */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {status === 'confirmed' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <span className="text-green-600 text-xs">{t('agent.cherryClaw.channels.wechat.connected')}</span>
            </>
          )}
          {status === 'disconnected' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              <span className="text-red-500 text-xs">{t('agent.cherryClaw.channels.wechat.disconnected')}</span>
            </>
          )}
          {(status === 'idle' || status === 'pending') && (
            <span className="text-blue-400 text-xs">{t('agent.cherryClaw.channels.wechat.loginHint')}</span>
          )}
        </div>
        {loginUserId && status === 'confirmed' && (
          <span className="text-gray-400 text-xs">
            User ID: <code className="select-all rounded bg-gray-100 px-1 dark:bg-gray-800">{loginUserId}</code>
          </span>
        )}
      </div>

      <ChannelPermissionMode channel={channel} onConfigChange={onConfigChange} />
      <NotifyCheckbox channel={channel} onConfigChange={onConfigChange} />

      {/* QR Code Modal */}
      <Modal
        open={!!qrUrl}
        title={t('agent.cherryClaw.channels.wechat.qrTitle')}
        footer={null}
        onCancel={() => {
          setQrUrl(null)
          if (status !== 'confirmed' && onRemove) onRemove()
        }}
        centered
        width={360}>
        <div className="flex flex-col items-center gap-4 py-4">
          {qrUrl && <QRCodeSVG value={qrUrl} size={240} level="M" />}
          <span className="text-center text-foreground-500 text-xs">
            {t('agent.cherryClaw.channels.wechat.qrHint')}
          </span>
        </div>
      </Modal>
    </div>
  )
}

// --------------- Edit Modal ---------------

type EditModalProps = {
  open: boolean
  channel: CherryClawChannel | null
  onClose: () => void
  onConfigChange: (channelId: string, updates: Partial<CherryClawChannel>) => void
  onRemove: (channelId: string) => void
}

const ChannelEditModal: FC<EditModalProps> = ({ open, channel, onClose, onConfigChange, onRemove }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')

  useEffect(() => {
    if (channel) setName(channel.name)
  }, [channel])

  const handleNameBlur = useCallback(() => {
    if (channel && name.trim() && name.trim() !== channel.name) {
      onConfigChange(channel.id, { name: name.trim() })
    }
  }, [channel, name, onConfigChange])

  const handleUpdate = useCallback(
    (updates: Partial<CherryClawChannel>) => {
      if (channel) onConfigChange(channel.id, updates)
    },
    [channel, onConfigChange]
  )

  if (!channel) return null

  return (
    <Modal open={open} title={channel.name} footer={null} onCancel={onClose} width={500} destroyOnHidden>
      <div className="flex flex-col gap-4 py-2">
        {/* Name */}
        <div>
          <label className="mb-1 block font-medium text-xs">{t('common.name')}</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={handleNameBlur} size="small" />
        </div>

        {/* Type-specific form */}
        {channel.type === 'telegram' && <TelegramChannelForm channel={channel} onConfigChange={handleUpdate} />}
        {channel.type === 'feishu' && <FeishuChannelForm channel={channel} onConfigChange={handleUpdate} />}
        {channel.type === 'qq' && <QQChannelForm channel={channel} onConfigChange={handleUpdate} />}
        {channel.type === 'wechat' && (
          <WeChatChannelForm channel={channel} onConfigChange={handleUpdate} onRemove={() => onRemove(channel.id)} />
        )}
      </div>
    </Modal>
  )
}

// --------------- Instance Row ---------------

type InstanceRowProps = {
  channel: CherryClawChannel
  onEdit: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
}

const ChannelInstanceRow: FC<InstanceRowProps> = ({ channel, onEdit, onDelete, onToggle }) => {
  const { t } = useTranslation()
  const isConnected = channel.enabled !== false && hasRequiredCredentials(channel)
  const summary = getChannelSummary(channel)

  return (
    <div className="flex items-center gap-3 border-default-100 border-t px-3 py-2.5">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{channel.name}</div>
        {summary && <div className="truncate text-foreground-400 text-xs">{summary}</div>}
      </div>
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
      <Switch checked={channel.enabled !== false} size="small" onChange={onToggle} />
    </div>
  )
}

// --------------- Type Section (collapsible) ---------------

type TypeSectionProps = {
  channelDef: AvailableChannel
  channels: CherryClawChannel[]
  onAdd: () => void
  onEdit: (channel: CherryClawChannel) => void
  onDelete: (channelId: string) => void
  onToggle: (channelId: string, enabled: boolean) => void
}

const ChannelTypeSection: FC<TypeSectionProps> = ({ channelDef, channels, onAdd, onEdit, onDelete, onToggle }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const count = channels.length

  return (
    <div className="overflow-hidden rounded-lg border border-default-200">
      {/* Header */}
      <div className="flex cursor-pointer items-center gap-2.5 px-3 py-3" onClick={() => setExpanded(!expanded)}>
        <ChevronDown
          size={14}
          className={`shrink-0 text-foreground-400 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
        />
        {getChannelTypeIcon(channelDef.type) && (
          <img src={getChannelTypeIcon(channelDef.type)} className="h-5 w-5 rounded-sm object-contain" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm">{channelDef.name}</span>
            <span
              className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-medium text-white text-xs ${
                count > 0 ? 'bg-green-500' : 'bg-gray-400'
              }`}>
              {count}
            </span>
          </div>
          <span className="text-foreground-400 text-xs">
            {channelDef.available ? t(channelDef.description) : t('agent.cherryClaw.channels.comingSoon')}
          </span>
        </div>
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          disabled={!channelDef.available}
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}>
          {t('agent.cherryClaw.channels.add')}
        </Button>
      </div>

      {/* Instance list */}
      {expanded && (
        <div>
          {channels.length === 0 && (
            <div className="border-default-100 border-t px-3 py-4 text-center text-foreground-400 text-sm">
              {t('agent.cherryClaw.channels.noInstances', { type: channelDef.name })}
            </div>
          )}
          {channels.map((ch) => (
            <ChannelInstanceRow
              key={ch.id}
              channel={ch}
              onEdit={() => onEdit(ch)}
              onDelete={() => onDelete(ch.id)}
              onToggle={(enabled) => onToggle(ch.id, enabled)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --------------- Main component ---------------

const ChannelsSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()

  const config = useMemo(() => (agentBase?.configuration ?? {}) as CherryClawConfiguration, [agentBase?.configuration])
  const channels = useMemo(() => config.channels ?? [], [config.channels])

  const [editingChannel, setEditingChannel] = useState<CherryClawChannel | null>(null)

  const getChannelsByType = useCallback((type: string) => channels.filter((ch) => ch.type === type), [channels])

  const updateChannels = useCallback(
    (newChannels: CherryClawChannel[]) => {
      if (!agentBase) return
      void update({
        id: agentBase.id,
        configuration: { ...config, channels: newChannels } as CherryClawConfiguration
      })
    },
    [agentBase, config, update]
  )

  const handleAdd = useCallback(
    (channelDef: AvailableChannel) => {
      const existingCount = channels.filter((ch) => ch.type === channelDef.type).length
      const newChannel: CherryClawChannel = {
        id: `ch_${channelDef.type}_${Date.now()}`,
        type: channelDef.type,
        name: existingCount > 0 ? `${channelDef.name} ${existingCount + 1}` : channelDef.name,
        enabled: true,
        config: channelDef.defaultConfig,
        is_notify_receiver: false
      }
      updateChannels([...channels, newChannel])
      setEditingChannel(newChannel)
    },
    [channels, updateChannels]
  )

  const handleConfigChange = useCallback(
    (channelId: string, updates: Partial<CherryClawChannel>) => {
      const updated = channels.map((ch) => (ch.id === channelId ? { ...ch, ...updates } : ch))
      updateChannels(updated)
      // Keep modal in sync
      if (editingChannel?.id === channelId) {
        setEditingChannel((prev) => (prev ? { ...prev, ...updates } : prev))
      }
    },
    [channels, editingChannel, updateChannels]
  )

  const handleDelete = useCallback(
    (channelId: string) => {
      updateChannels(channels.filter((ch) => ch.id !== channelId))
      if (editingChannel?.id === channelId) setEditingChannel(null)
    },
    [channels, editingChannel, updateChannels]
  )

  const handleToggle = useCallback(
    (channelId: string, enabled: boolean) => {
      updateChannels(channels.map((ch) => (ch.id === channelId ? { ...ch, enabled } : ch)))
    },
    [channels, updateChannels]
  )

  if (!agentBase) return null

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.cherryClaw.channels.title')}</SettingsTitle>
        <span className="text-foreground-500 text-sm">{t('agent.cherryClaw.channels.description')}</span>
      </SettingsItem>

      <div className="mt-2 flex flex-col gap-3">
        {AVAILABLE_CHANNELS.map((channelDef) => (
          <ChannelTypeSection
            key={channelDef.type}
            channelDef={channelDef}
            channels={getChannelsByType(channelDef.type)}
            onAdd={() => handleAdd(channelDef)}
            onEdit={setEditingChannel}
            onDelete={handleDelete}
            onToggle={handleToggle}
          />
        ))}
      </div>

      <ChannelEditModal
        open={!!editingChannel}
        channel={editingChannel}
        onClose={() => setEditingChannel(null)}
        onConfigChange={handleConfigChange}
        onRemove={handleDelete}
      />
    </SettingsContainer>
  )
}

export { ChannelsSettings }
export default ChannelsSettings
