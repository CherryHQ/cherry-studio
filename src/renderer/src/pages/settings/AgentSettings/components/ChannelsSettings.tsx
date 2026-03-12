import type { CherryClawChannel, CherryClawConfiguration, FeishuChannelConfig, FeishuDomain } from '@renderer/types'
import type { CardProps } from 'antd'
import { Card, Checkbox, Input, Select, Switch } from 'antd'
import type { ReactNode } from 'react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

// --------------- Channel catalog registry ---------------

type AvailableChannel = {
  type: 'telegram' | 'feishu' | 'qq' // extend later: | 'discord' | 'slack'
  name: string
  description: string // i18n key
  icon: string
  available: boolean // false = "coming soon"
  defaultConfig: CherryClawChannel['config']
}

const AVAILABLE_CHANNELS: AvailableChannel[] = [
  {
    type: 'feishu',
    name: 'Feishu',
    description: 'agent.cherryClaw.channels.feishu.description',
    icon: '🪶',
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
    icon: '✈️',
    available: true,
    defaultConfig: { bot_token: '', allowed_chat_ids: [] }
  },
  {
    type: 'qq',
    name: 'QQ',
    description: 'agent.cherryClaw.channels.qq.description',
    icon: '🐧',
    available: true,
    defaultConfig: { app_id: '', client_secret: '', allowed_chat_ids: [] }
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

const FeishuChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()

  return (
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

// --------------- Main component ---------------

const ChannelsSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()

  const config = useMemo(() => (agentBase?.configuration ?? {}) as CherryClawConfiguration, [agentBase?.configuration])
  const channels = useMemo(() => config.channels ?? [], [config.channels])

  const getChannel = useCallback((type: string) => channels.find((ch) => ch.type === type), [channels])

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
        updateChannels(channels.map((ch) => (ch.type === channelDef.type ? { ...ch, enabled } : ch)))
      }
    },
    [channels, getChannel, updateChannels]
  )

  const handleConfigChange = useCallback(
    (type: string, updates: Partial<CherryClawChannel>) => {
      updateChannels(channels.map((ch) => (ch.type === type ? { ...ch, ...updates } : ch)))
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
        {AVAILABLE_CHANNELS.map((channelDef) => {
          const channel = getChannel(channelDef.type)
          const isEnabled = !!channel && channel.enabled !== false

          return (
            <Card
              key={channelDef.type}
              className="border border-default-200"
              title={
                <div className="flex items-center justify-between gap-2 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span>{channelDef.icon}</span>
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
              {isEnabled && channel && channel.type === 'telegram' && (
                <TelegramChannelCard
                  channel={channel}
                  onConfigChange={(updates) => handleConfigChange(channel.type, updates)}
                />
              )}
              {isEnabled && channel && channel.type === 'feishu' && (
                <FeishuChannelCard
                  channel={channel}
                  onConfigChange={(updates) => handleConfigChange(channel.type, updates)}
                />
              )}
              {isEnabled && channel && channel.type === 'qq' && (
                <QQChannelCard
                  channel={channel}
                  onConfigChange={(updates) => handleConfigChange(channel.type, updates)}
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
