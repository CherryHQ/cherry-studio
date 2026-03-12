import type {
  CherryClawChannel,
  CherryClawConfiguration,
  FeishuChannelConfig,
  FeishuDomain,
  TelegramChannelConfig
} from '@renderer/types'
import type { CardProps } from 'antd'
import { Card, Checkbox, Input, Select, Switch } from 'antd'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

// --------------- Channel catalog registry ---------------

type AvailableChannel = {
  type: 'telegram' | 'feishu' // extend later: | 'discord' | 'slack'
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

// --------------- Telegram inline config ---------------

type ChannelCardProps = {
  channel: CherryClawChannel
  onConfigChange: (updates: Partial<CherryClawChannel>) => void
}

const TelegramChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  const cfg = channel.config as TelegramChannelConfig

  const [botToken, setBotToken] = useState(cfg.bot_token ?? '')
  const [chatIds, setChatIds] = useState((cfg.allowed_chat_ids ?? []).join(', '))

  useEffect(() => {
    setBotToken(cfg.bot_token ?? '')
    setChatIds((cfg.allowed_chat_ids ?? []).join(', '))
  }, [cfg.bot_token, cfg.allowed_chat_ids])

  const saveBotToken = useCallback(() => {
    const trimmed = botToken.trim()
    if (trimmed !== (cfg.bot_token ?? '')) {
      onConfigChange({ config: { ...cfg, bot_token: trimmed } })
    }
  }, [botToken, cfg, onConfigChange])

  const saveChatIds = useCallback(() => {
    const ids = chatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (JSON.stringify(ids) !== JSON.stringify(cfg.allowed_chat_ids ?? [])) {
      onConfigChange({ config: { ...cfg, allowed_chat_ids: ids } })
    }
  }, [chatIds, cfg, onConfigChange])

  return (
    <div className="flex flex-col gap-3 pb-3">
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
      <NotifyCheckbox channel={channel} onConfigChange={onConfigChange} />
    </div>
  )
}

// --------------- Feishu inline config ---------------

const FeishuChannelCard: FC<ChannelCardProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  const cfg = channel.config as FeishuChannelConfig

  const [appId, setAppId] = useState(cfg.app_id ?? '')
  const [appSecret, setAppSecret] = useState(cfg.app_secret ?? '')
  const [encryptKey, setEncryptKey] = useState(cfg.encrypt_key ?? '')
  const [verificationToken, setVerificationToken] = useState(cfg.verification_token ?? '')
  const [chatIds, setChatIds] = useState((cfg.allowed_chat_ids ?? []).join(', '))

  useEffect(() => {
    setAppId(cfg.app_id ?? '')
    setAppSecret(cfg.app_secret ?? '')
    setEncryptKey(cfg.encrypt_key ?? '')
    setVerificationToken(cfg.verification_token ?? '')
    setChatIds((cfg.allowed_chat_ids ?? []).join(', '))
  }, [cfg.app_id, cfg.app_secret, cfg.encrypt_key, cfg.verification_token, cfg.allowed_chat_ids])

  const saveAppId = useCallback(() => {
    const trimmed = appId.trim()
    if (trimmed !== (cfg.app_id ?? '')) {
      onConfigChange({ config: { ...cfg, app_id: trimmed } })
    }
  }, [appId, cfg, onConfigChange])

  const saveAppSecret = useCallback(() => {
    const trimmed = appSecret.trim()
    if (trimmed !== (cfg.app_secret ?? '')) {
      onConfigChange({ config: { ...cfg, app_secret: trimmed } })
    }
  }, [appSecret, cfg, onConfigChange])

  const saveEncryptKey = useCallback(() => {
    const trimmed = encryptKey.trim()
    if (trimmed !== (cfg.encrypt_key ?? '')) {
      onConfigChange({ config: { ...cfg, encrypt_key: trimmed } })
    }
  }, [encryptKey, cfg, onConfigChange])

  const saveVerificationToken = useCallback(() => {
    const trimmed = verificationToken.trim()
    if (trimmed !== (cfg.verification_token ?? '')) {
      onConfigChange({ config: { ...cfg, verification_token: trimmed } })
    }
  }, [verificationToken, cfg, onConfigChange])

  const saveChatIds = useCallback(() => {
    const ids = chatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (JSON.stringify(ids) !== JSON.stringify(cfg.allowed_chat_ids ?? [])) {
      onConfigChange({ config: { ...cfg, allowed_chat_ids: ids } })
    }
  }, [chatIds, cfg, onConfigChange])

  const handleDomainChange = useCallback(
    (value: FeishuDomain) => {
      onConfigChange({ config: { ...cfg, domain: value } })
    },
    [cfg, onConfigChange]
  )

  return (
    <div className="flex flex-col gap-3 pb-3">
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.feishu.appId')}</label>
        <Input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          onBlur={saveAppId}
          placeholder={t('agent.cherryClaw.channels.feishu.appIdPlaceholder')}
          size="small"
        />
      </div>
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.feishu.appSecret')}</label>
        <Input.Password
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          onBlur={saveAppSecret}
          placeholder={t('agent.cherryClaw.channels.feishu.appSecretPlaceholder')}
          size="small"
        />
      </div>
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.feishu.encryptKey')}</label>
        <Input.Password
          value={encryptKey}
          onChange={(e) => setEncryptKey(e.target.value)}
          onBlur={saveEncryptKey}
          placeholder={t('agent.cherryClaw.channels.feishu.encryptKeyPlaceholder')}
          size="small"
        />
      </div>
      <div>
        <label className="mb-1 block font-medium text-xs">
          {t('agent.cherryClaw.channels.feishu.verificationToken')}
        </label>
        <Input.Password
          value={verificationToken}
          onChange={(e) => setVerificationToken(e.target.value)}
          onBlur={saveVerificationToken}
          placeholder={t('agent.cherryClaw.channels.feishu.verificationTokenPlaceholder')}
          size="small"
        />
      </div>
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
      <div>
        <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.feishu.chatIds')}</label>
        <Input
          value={chatIds}
          onChange={(e) => setChatIds(e.target.value)}
          onBlur={saveChatIds}
          placeholder={t('agent.cherryClaw.channels.feishu.chatIdsPlaceholder')}
          size="small"
        />
        <span className="mt-1 block text-gray-400 text-xs">{t('agent.cherryClaw.channels.feishu.chatIdsHint')}</span>
      </div>
      <NotifyCheckbox channel={channel} onConfigChange={onConfigChange} />
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
            </Card>
          )
        })}
      </div>
    </SettingsContainer>
  )
}

export { ChannelsSettings }
export default ChannelsSettings
