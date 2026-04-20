import type { FeishuChannelConfig, FeishuDomain, PermissionMode } from '@renderer/types'
import { Input, Modal, Select } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
import type { ReactNode } from 'react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChannelData } from './channelTypes'

// --------------- Permission mode ---------------

const PERMISSION_MODE_OPTIONS: Array<{ value: PermissionMode | ''; labelKey: string }> = [
  { value: '', labelKey: 'agent.cherryClaw.channels.security.inheritFromAgent' },
  { value: 'default', labelKey: 'agent.settings.tooling.permissionMode.default.title' },
  { value: 'acceptEdits', labelKey: 'agent.settings.tooling.permissionMode.acceptEdits.title' },
  { value: 'bypassPermissions', labelKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title' },
  { value: 'plan', labelKey: 'agent.settings.tooling.permissionMode.plan.title' }
]

// --------------- Form types ---------------

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
  configKey?: string
}

type ChannelFormProps = {
  channel: ChannelData
  onConfigChange: (updates: Partial<ChannelData>) => void
}

type ChannelFieldsFormProps = ChannelFormProps & {
  fields: FieldDef[]
  chatIds: ChatIdsConfig
  extraContent?: ReactNode
}

// --------------- Shared form components ---------------

const ChannelPermissionMode: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1">
      <label className="font-medium text-xs">{t('agent.cherryClaw.channels.security.permissionMode')}</label>
      <Select
        value={channel.permissionMode ?? ''}
        onChange={(value) => onConfigChange({ permissionMode: value === '' ? undefined : value })}
        size="small"
        className="w-full"
        options={PERMISSION_MODE_OPTIONS.map((opt) => ({
          value: opt.value,
          label: t(opt.labelKey)
        }))}
      />
    </div>
  )
}

const ChannelFieldsForm: FC<ChannelFieldsFormProps> = ({
  channel,
  onConfigChange,
  fields,
  chatIds: chatIdsConfig,
  extraContent
}) => {
  const { t } = useTranslation()
  const cfg = channel.config
  const idsKey = chatIdsConfig.configKey ?? 'allowed_chat_ids'

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, (cfg[f.key] as string) ?? '']))
  )
  const [chatIds, setChatIds] = useState(((cfg[idsKey] as string[]) ?? []).join(', '))

  useEffect(() => {
    setFieldValues(Object.fromEntries(fields.map((f) => [f.key, (cfg[f.key] as string) ?? ''])))
    setChatIds(((cfg[idsKey] as string[]) ?? []).join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fields.map((f) => cfg[f.key])), cfg[idsKey]])

  const saveField = useCallback(
    (key: string, value: string) => {
      const trimmed = value.trim()
      if (trimmed !== ((cfg[key] as string) ?? '')) {
        onConfigChange({ config: { ...cfg, [key]: trimmed } })
      }
    },
    [cfg, onConfigChange]
  )

  const saveChatIds = useCallback(() => {
    const ids = chatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (JSON.stringify(ids) !== JSON.stringify((cfg[idsKey] as string[]) ?? [])) {
      onConfigChange({ config: { ...cfg, [idsKey]: ids } })
    }
  }, [chatIds, cfg, idsKey, onConfigChange])

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
          {!chatIds.trim() && idsKey === 'allowed_chat_ids' && (
            <span className="mt-1 block text-orange-400 text-xs">
              {t('agent.cherryClaw.channels.chatIdsAutoTrackHint')}
            </span>
          )}
          {chatIdsConfig.extraHint && (
            <span className="mt-1 block text-blue-400 text-xs">{chatIdsConfig.extraHint}</span>
          )}
        </div>
      </div>
      <ChannelPermissionMode channel={channel} onConfigChange={onConfigChange} />
    </div>
  )
}

// --------------- Type-specific forms ---------------

export const TelegramForm: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsForm
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

const FeishuDomainSelector: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  const cfg = channel.config
  return (
    <div>
      <label className="mb-1 block font-medium text-xs">{t('agent.cherryClaw.channels.feishu.domain')}</label>
      <Select<FeishuDomain>
        value={(cfg.domain as FeishuDomain) ?? 'feishu'}
        onChange={(value) => onConfigChange({ config: { ...cfg, domain: value } })}
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

export const FeishuForm: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  const cfg = channel.config as FeishuChannelConfig
  const hasCredentials = !!(cfg.app_id && cfg.app_secret)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<FeishuStatus>(hasCredentials ? 'confirmed' : 'idle')

  useEffect(() => {
    const cleanup = window.api.feishu.onQrLogin((data) => {
      if (data.channelId !== channel.id) return
      if (data.status === 'confirmed') {
        setQrUrl(null)
        setStatus('confirmed')
        // Credentials are saved by main process (saveCredentialsAndReconnect).
        // ChannelDetail will reload data on statusChange → connected.
      } else if (data.status === 'expired') {
        setQrUrl(null)
        setStatus('expired')
      } else if (data.url) {
        setQrUrl(data.url)
        setStatus('pending')
      }
    })
    return cleanup
  }, [channel.id])

  return (
    <div className="flex flex-col gap-3">
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
      <ChannelFieldsForm
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

export const DiscordForm: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsForm
      channel={channel}
      onConfigChange={onConfigChange}
      fields={[
        {
          key: 'bot_token',
          label: t('agent.cherryClaw.channels.discord.botToken'),
          placeholder: t('agent.cherryClaw.channels.discord.botTokenPlaceholder'),
          secret: true,
          span: 2
        }
      ]}
      chatIds={{
        label: t('agent.cherryClaw.channels.discord.channelIds'),
        placeholder: t('agent.cherryClaw.channels.discord.channelIdsPlaceholder'),
        hint: t('agent.cherryClaw.channels.discord.channelIdsHint'),
        extraHint: t('agent.cherryClaw.channels.discord.whoamiTip'),
        fullWidth: true,
        configKey: 'allowed_channel_ids'
      }}
    />
  )
}

export const QQForm: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsForm
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

export const WeChatForm: FC<ChannelFormProps & { onRemove?: () => void }> = ({ channel, onConfigChange, onRemove }) => {
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

export const SlackForm: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsForm
      channel={channel}
      onConfigChange={onConfigChange}
      fields={[
        {
          key: 'bot_token',
          label: t('agent.cherryClaw.channels.slack.botToken'),
          placeholder: t('agent.cherryClaw.channels.slack.botTokenPlaceholder'),
          secret: true,
          span: 2
        },
        {
          key: 'app_token',
          label: t('agent.cherryClaw.channels.slack.appToken'),
          placeholder: t('agent.cherryClaw.channels.slack.appTokenPlaceholder'),
          secret: true,
          span: 2
        }
      ]}
      chatIds={{
        label: t('agent.cherryClaw.channels.slack.channelIds'),
        placeholder: t('agent.cherryClaw.channels.slack.channelIdsPlaceholder'),
        hint: t('agent.cherryClaw.channels.slack.channelIdsHint'),
        extraHint: t('agent.cherryClaw.channels.slack.whoamiTip'),
        fullWidth: true,
        configKey: 'allowed_channel_ids'
      }}
    />
  )
}

export const getFormForType = (type: string) => {
  switch (type) {
    case 'telegram':
      return TelegramForm
    case 'feishu':
      return FeishuForm
    case 'qq':
      return QQForm
    case 'discord':
      return DiscordForm
    case 'slack':
      return SlackForm
    case 'wechat':
      return WeChatForm
    default:
      return null
  }
}
