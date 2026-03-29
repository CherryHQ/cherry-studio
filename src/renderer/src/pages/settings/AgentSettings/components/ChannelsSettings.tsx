import { PlusOutlined } from '@ant-design/icons'
import type { CherryClawChannel, CherryClawConfiguration, FeishuChannelConfig, FeishuDomain } from '@renderer/types'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import type { CardProps } from 'antd'
import { Button, Card, Checkbox, Input, Modal, Select, Switch } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
import type { ReactNode } from 'react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

// --------------- Channel catalog registry ---------------

type AvailableChannel = {
  type: 'telegram' | 'feishu' | 'qq' | 'wechat' // extend later: | 'discord' | 'slack'
  name: string
  description: string // i18n key
  available: boolean // false = "coming soon"
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

const cardStyles: CardProps['styles'] = {
  header: {
    paddingLeft: '12px',
    paddingRight: '12px',
    borderBottom: 'none'
  },
  body: {
    paddingLeft: '12px',
    paddingRight: '12px',
    paddingTop: '0px',
    paddingBottom: '0px'
  }
}

// --------------- Shared notify checkbox ---------------

type NotifyCheckboxProps = {
  channel: CherryClawChannel
  onConfigChange: (updates: Partial<CherryClawChannel>) => void
}

const NotifyCheckbox: FC<NotifyCheckboxProps> = ({ channel, onConfigChange }) => {
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

// --------------- Shared channel config field types ---------------

type ChannelCardProps = {
  channel: CherryClawChannel
  onConfigChange: (updates: Partial<CherryClawChannel>) => void
}

type FieldDef = {
  key: string
  label: string
  placeholder: string
  secret?: boolean
}

type ChatIdsConfig = {
  label: string
  placeholder: string
  hint: string
  extraHint?: string
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
  // Use Record for generic field access; the union type is preserved via spread on save
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
    <div className="flex flex-col gap-3 pb-3">
      {fields.map((field) => (
        <div key={field.key}>
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
      <div>
        <label className="mb-1 block font-medium text-xs">{chatIdsConfig.label}</label>
        <Input
          value={chatIds}
          onChange={(e) => setChatIds(e.target.value)}
          onBlur={saveChatIds}
          placeholder={chatIdsConfig.placeholder}
          size="small"
        />
        <span className="mt-1 block text-gray-400 text-xs">{chatIdsConfig.hint}</span>
        {chatIdsConfig.extraHint && <span className="mt-1 block text-blue-400 text-xs">{chatIdsConfig.extraHint}</span>}
      </div>
      <NotifyCheckbox channel={channel} onConfigChange={onConfigChange} />
    </div>
  )
}

// --------------- Telegram inline config ---------------

const TelegramChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
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

// --------------- Feishu inline config ---------------

const FeishuDomainSelector: FC<{
  channel: CherryClawChannel
  onConfigChange: (updates: Partial<CherryClawChannel>) => void
}> = ({ channel, onConfigChange }) => {
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

const FeishuChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
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
        // Save the obtained credentials back to channel config
        onConfigChange({
          config: { ...cfg, app_id: data.appId, app_secret: data.appSecret }
        })
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
    <div className="flex flex-col gap-3 pb-3">
      {/* QR status indicator */}
      {!hasCredentials && (
        <div className="flex flex-col gap-1">
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
        </div>
      )}

      {hasCredentials && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          <span className="text-green-600 text-xs">{t('agent.cherryClaw.channels.feishu.connected')}</span>
        </div>
      )}

      {/* Standard credential fields (shown always, auto-filled after QR scan) */}
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
        onCancel={() => setQrUrl(null)}
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

// --------------- QQ inline config ---------------

const QQChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
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
        extraHint: t('agent.cherryClaw.channels.qq.whoamiTip')
      }}
    />
  )
}

// --------------- WeChat inline config ---------------

type WeChatStatus = 'idle' | 'pending' | 'confirmed' | 'disconnected'

/** Status row for a single WeChat channel instance. */
const WeChatInstanceStatus: FC<{ channelId: string; name: string; onRemove?: () => void }> = ({
  channelId,
  name,
  onRemove
}) => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<WeChatStatus>('idle')
  const [loginUserId, setLoginUserId] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  useEffect(() => {
    window.api.wechat.hasCredentials(channelId).then((result) => {
      if (result.exists) {
        setStatus('confirmed')
        if (result.userId) setLoginUserId(result.userId)
      }
    })
  }, [channelId])

  useEffect(() => {
    const cleanup = window.api.wechat.onQrLogin((data) => {
      if (data.channelId !== channelId) return
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
  }, [channelId])

  return (
    <>
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
          {name && <span className="text-gray-400 text-xs">({name})</span>}
        </div>
        {loginUserId && status === 'confirmed' && (
          <span className="text-gray-400 text-xs">
            User ID: <code className="select-all rounded bg-gray-100 px-1 dark:bg-gray-800">{loginUserId}</code>
          </span>
        )}
      </div>
      <Modal
        open={!!qrUrl}
        title={t('agent.cherryClaw.channels.wechat.qrTitle')}
        footer={null}
        onCancel={() => {
          setQrUrl(null)
          // If the channel hasn't been confirmed yet, remove it to stop the login flow
          if (status !== 'confirmed' && onRemove) {
            onRemove()
          }
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
    </>
  )
}

type WeChatChannelCardProps = {
  channels: CherryClawChannel[]
  primaryChannel: CherryClawChannel
  onConfigChange: (channelId: string, updates: Partial<CherryClawChannel>) => void
  onAddAccount: () => void
  onRemoveAccount: (channelId: string) => void
}

const WeChatChannelCard: FC<WeChatChannelCardProps> = ({
  channels,
  primaryChannel,
  onConfigChange,
  onAddAccount,
  onRemoveAccount
}) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3 pb-3">
      {channels.map((ch) => (
        <WeChatInstanceStatus
          key={ch.id}
          channelId={ch.id}
          name={channels.length > 1 ? ch.name : ''}
          onRemove={() => onRemoveAccount(ch.id)}
        />
      ))}
      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={onAddAccount} className="self-start">
        {t('agent.cherryClaw.channels.wechat.addAccount')}
      </Button>
      <NotifyCheckbox
        channel={primaryChannel}
        onConfigChange={(updates) => onConfigChange(primaryChannel.id, updates)}
      />
    </div>
  )
}

// --------------- Main component ---------------

const ChannelsSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()

  const config = useMemo(() => (agentBase?.configuration ?? {}) as CherryClawConfiguration, [agentBase?.configuration])
  const channels = useMemo(() => config.channels ?? [], [config.channels])

  const getChannel = useCallback((type: string) => channels.find((ch) => ch.type === type), [channels])
  const getChannelsByType = useCallback((type: string) => channels.filter((ch) => ch.type === type), [channels])

  const updateChannels = useCallback(
    (newChannels: CherryClawChannel[]) => {
      if (!agentBase) return
      update({
        id: agentBase.id,
        configuration: {
          ...config,
          channels: newChannels
        } as CherryClawConfiguration
      })
    },
    [agentBase, config, update]
  )

  const handleToggle = useCallback(
    (channelDef: AvailableChannel, enabled: boolean) => {
      const existing = getChannel(channelDef.type)
      if (enabled && !existing) {
        updateChannels([
          ...channels,
          {
            id: `ch_${channelDef.type}_${Date.now()}`,
            type: channelDef.type,
            name: channelDef.name,
            enabled: true,
            config: channelDef.defaultConfig,
            is_notify_receiver: false
          }
        ])
      } else if (existing) {
        // Toggle all channels of this type
        updateChannels(channels.map((ch) => (ch.type === channelDef.type ? { ...ch, enabled } : ch)))
      }
    },
    [channels, getChannel, updateChannels]
  )

  const handleConfigChange = useCallback(
    (channelId: string, updates: Partial<CherryClawChannel>) => {
      updateChannels(channels.map((ch) => (ch.id === channelId ? { ...ch, ...updates } : ch)))
    },
    [channels, updateChannels]
  )

  const handleRemoveWeChatAccount = useCallback(
    (channelId: string) => {
      updateChannels(channels.filter((ch) => ch.id !== channelId))
    },
    [channels, updateChannels]
  )

  const handleAddWeChatAccount = useCallback(() => {
    const wechatDef = AVAILABLE_CHANNELS.find((d) => d.type === 'wechat')!
    const existingCount = channels.filter((ch) => ch.type === 'wechat').length
    updateChannels([
      ...channels,
      {
        id: `ch_wechat_${Date.now()}`,
        type: 'wechat',
        name: existingCount > 0 ? `${wechatDef.name} ${existingCount + 1}` : wechatDef.name,
        enabled: true,
        config: wechatDef.defaultConfig,
        is_notify_receiver: false
      }
    ])
  }, [channels, updateChannels])

  if (!agentBase) return null

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.cherryClaw.channels.title')}</SettingsTitle>
        <span className="text-foreground-500 text-sm">{t('agent.cherryClaw.channels.description')}</span>
      </SettingsItem>

      <div className="mt-2 flex flex-col gap-3">
        {AVAILABLE_CHANNELS.map((channelDef) => {
          const primaryChannel = getChannel(channelDef.type)
          const isEnabled = !!primaryChannel && primaryChannel.enabled !== false

          return (
            <Card
              key={channelDef.type}
              className="border border-default-200"
              title={
                <div className="flex items-center justify-between gap-2 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      {getChannelTypeIcon(channelDef.type) && (
                        <img src={getChannelTypeIcon(channelDef.type)} className="h-4 w-4 rounded-sm object-contain" />
                      )}
                      <span className="font-medium text-sm">{channelDef.name}</span>
                    </div>
                    <span className="text-foreground-500 text-xs">
                      {channelDef.available ? t(channelDef.description) : t('agent.cherryClaw.channels.comingSoon')}
                    </span>
                  </div>
                  <Switch
                    checked={isEnabled}
                    size="small"
                    disabled={!channelDef.available}
                    onChange={(checked) => handleToggle(channelDef, checked)}
                  />
                </div>
              }
              styles={cardStyles}>
              {isEnabled && primaryChannel && primaryChannel.type === 'telegram' && (
                <TelegramChannelCard
                  channel={primaryChannel}
                  onConfigChange={(updates) => handleConfigChange(primaryChannel.id, updates)}
                />
              )}
              {isEnabled && primaryChannel && primaryChannel.type === 'feishu' && (
                <FeishuChannelCard
                  channel={primaryChannel}
                  onConfigChange={(updates) => handleConfigChange(primaryChannel.id, updates)}
                />
              )}
              {isEnabled && primaryChannel && primaryChannel.type === 'qq' && (
                <QQChannelCard
                  channel={primaryChannel}
                  onConfigChange={(updates) => handleConfigChange(primaryChannel.id, updates)}
                />
              )}
              {isEnabled && primaryChannel && primaryChannel.type === 'wechat' && (
                <WeChatChannelCard
                  channels={getChannelsByType('wechat')}
                  primaryChannel={primaryChannel}
                  onConfigChange={(id, updates) => handleConfigChange(id, updates)}
                  onAddAccount={handleAddWeChatAccount}
                  onRemoveAccount={handleRemoveWeChatAccount}
                />
              )}
            </Card>
          )
        })}
      </div>
    </SettingsContainer>
  )
}

export { ChannelsSettings }
export default ChannelsSettings
