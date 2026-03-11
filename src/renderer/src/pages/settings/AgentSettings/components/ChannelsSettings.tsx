import type { CherryClawChannel, CherryClawConfiguration } from '@renderer/types'
import type { CardProps } from 'antd'
import { Card, Checkbox, Input, Switch } from 'antd'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

// --------------- Channel catalog registry ---------------

type AvailableChannel = {
  type: 'telegram' | 'qq' // extend later: | 'discord' | 'slack'
  name: string
  description: string // i18n key
  icon: string
  available: boolean // false = "coming soon"
}

const AVAILABLE_CHANNELS: AvailableChannel[] = [
  {
    type: 'telegram',
    name: 'Telegram',
    description: 'agent.cherryClaw.channels.telegram.description',
    icon: '✈️',
    available: true
  },
  {
    type: 'qq',
    name: 'QQ',
    description: 'agent.cherryClaw.channels.qq.description',
    icon: '🐧',
    available: true
  }
  // Future: { type: 'discord', name: 'Discord', description: 'agent.cherryClaw.channels.discord.description', icon: '💬', available: false },
  // Future: { type: 'slack', name: 'Slack', description: 'agent.cherryClaw.channels.slack.description', icon: '💼', available: false },
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

// --------------- Telegram inline config ---------------

type ChannelCardProps = {
  channel: CherryClawChannel
  onConfigChange: (updates: Partial<CherryClawChannel>) => void
}

const TelegramChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()

  const config = channel.config as { bot_token?: string; allowed_chat_ids?: string[] }
  const [botToken, setBotToken] = useState(config.bot_token ?? '')
  const [chatIds, setChatIds] = useState((config.allowed_chat_ids ?? []).join(', '))

  // Sync from props when channel changes externally
  useEffect(() => {
    setBotToken(config.bot_token ?? '')
    setChatIds((config.allowed_chat_ids ?? []).join(', '))
  }, [config.bot_token, config.allowed_chat_ids])

  const saveBotToken = useCallback(() => {
    const trimmed = botToken.trim()
    if (trimmed !== (config.bot_token ?? '')) {
      onConfigChange({ config: { ...config, bot_token: trimmed } as typeof channel.config })
    }
  }, [botToken, config, onConfigChange])

  const saveChatIds = useCallback(() => {
    const ids = chatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const current = config.allowed_chat_ids ?? []
    if (JSON.stringify(ids) !== JSON.stringify(current)) {
      onConfigChange({ config: { ...config, allowed_chat_ids: ids } as typeof channel.config })
    }
  }, [chatIds, config, onConfigChange])

  return (
    <div className="flex flex-col gap-3 pb-3">
      {/* Bot Token */}
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.telegram.botToken')}</label>
        <Input.Password
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          onBlur={saveBotToken}
          placeholder={t('agent.cherryClaw.channels.telegram.botTokenPlaceholder')}
          size="small"
        />
      </div>

      {/* Allowed Chat IDs */}
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.telegram.chatIds')}</label>
        <Input
          value={chatIds}
          onChange={(e) => setChatIds(e.target.value)}
          onBlur={saveChatIds}
          placeholder={t('agent.cherryClaw.channels.telegram.chatIdsPlaceholder')}
          size="small"
        />
        <span className="mt-1 block text-gray-400 text-xs">{t('agent.cherryClaw.channels.telegram.chatIdsHint')}</span>
      </div>

      {/* Notify receiver checkbox */}
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
    </div>
  )
}

// --------------- QQ inline config ---------------

const QQChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()

  const config = channel.config as {
    app_id?: string
    client_secret?: string
    allowed_chat_ids?: string[]
  }
  const [appId, setAppId] = useState(config.app_id ?? '')
  const [clientSecret, setClientSecret] = useState(config.client_secret ?? '')
  const [chatIds, setChatIds] = useState((config.allowed_chat_ids ?? []).join(', '))

  useEffect(() => {
    setAppId(config.app_id ?? '')
    setClientSecret(config.client_secret ?? '')
    setChatIds((config.allowed_chat_ids ?? []).join(', '))
  }, [config.app_id, config.client_secret, config.allowed_chat_ids])

  const saveAppId = useCallback(() => {
    const trimmed = appId.trim()
    if (trimmed !== (config.app_id ?? '')) {
      onConfigChange({ config: { ...config, app_id: trimmed } as typeof channel.config })
    }
  }, [appId, config, onConfigChange])

  const saveClientSecret = useCallback(() => {
    const trimmed = clientSecret.trim()
    if (trimmed !== (config.client_secret ?? '')) {
      onConfigChange({ config: { ...config, client_secret: trimmed } as typeof channel.config })
    }
  }, [clientSecret, config, onConfigChange])

  const saveChatIds = useCallback(() => {
    const ids = chatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const current = config.allowed_chat_ids ?? []
    if (JSON.stringify(ids) !== JSON.stringify(current)) {
      onConfigChange({ config: { ...config, allowed_chat_ids: ids } as typeof channel.config })
    }
  }, [chatIds, config, onConfigChange])

  return (
    <div className="flex flex-col gap-3 pb-3">
      {/* App ID */}
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.qq.appId')}</label>
        <Input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          onBlur={saveAppId}
          placeholder={t('agent.cherryClaw.channels.qq.appIdPlaceholder')}
          size="small"
        />
      </div>

      {/* Client Secret */}
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.qq.clientSecret')}</label>
        <Input.Password
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          onBlur={saveClientSecret}
          placeholder={t('agent.cherryClaw.channels.qq.clientSecretPlaceholder')}
          size="small"
        />
      </div>

      {/* Allowed Chat IDs */}
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.qq.chatIds')}</label>
        <Input
          value={chatIds}
          onChange={(e) => setChatIds(e.target.value)}
          onBlur={saveChatIds}
          placeholder={t('agent.cherryClaw.channels.qq.chatIdsPlaceholder')}
          size="small"
        />
        <span className="mt-1 block text-gray-400 text-xs">{t('agent.cherryClaw.channels.qq.chatIdsHint')}</span>
      </div>

      {/* Notify receiver checkbox */}
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
    </div>
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

  const getDefaultConfig = useCallback((type: AvailableChannel['type']): CherryClawChannel['config'] => {
    switch (type) {
      case 'telegram':
        return { bot_token: '', allowed_chat_ids: [] }
      case 'qq':
        return { app_id: '', client_secret: '', allowed_chat_ids: [] }
    }
  }, [])

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
            config: getDefaultConfig(channelDef.type),
            is_notify_receiver: false
          }
        ])
      } else if (existing) {
        updateChannels(channels.map((ch) => (ch.type === channelDef.type ? { ...ch, enabled } : ch)))
      }
    },
    [channels, getChannel, getDefaultConfig, updateChannels]
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
