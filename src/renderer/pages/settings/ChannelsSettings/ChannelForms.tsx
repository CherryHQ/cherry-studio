import {
  Alert,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  InfoTooltip,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { FeishuChannelConfig, FeishuDomain, PermissionMode } from '@renderer/types/agent'
import { Eye, EyeOff } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { ReactNode } from 'react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChannelData } from './channelTypes'

// --------------- Permission mode ---------------

const PERMISSION_MODE_OPTIONS: Array<{ value: PermissionMode | ''; labelKey: string }> = [
  { value: '', labelKey: 'agent.channels.security.inheritFromAgent' },
  { value: 'default', labelKey: 'agent.settings.tooling.permissionMode.default.title' },
  { value: 'acceptEdits', labelKey: 'agent.settings.tooling.permissionMode.acceptEdits.title' },
  { value: 'bypassPermissions', labelKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title' },
  { value: 'plan', labelKey: 'agent.settings.tooling.permissionMode.plan.title' }
]

const INHERIT_PERMISSION_MODE_VALUE = '__inherit'

// --------------- Form types ---------------

type FieldDef = {
  key: string
  label: string
  placeholder: string
  hint?: string
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
      <label className="font-normal text-xs">{t('agent.channels.security.permissionMode')}</label>
      <Select
        value={channel.permissionMode ?? INHERIT_PERMISSION_MODE_VALUE}
        onValueChange={(value) =>
          onConfigChange({
            permissionMode: value === INHERIT_PERMISSION_MODE_VALUE ? null : (value as PermissionMode)
          })
        }>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERMISSION_MODE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value || 'inherit'} value={opt.value || INHERIT_PERMISSION_MODE_VALUE}>
              {t(opt.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})

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
            <label className="mb-1 flex items-center gap-1 font-normal text-xs">
              {field.label}
              {field.hint && (
                <InfoTooltip
                  content={field.hint}
                  iconProps={{ size: 12, className: 'shrink-0 cursor-pointer text-foreground-muted' }}
                />
              )}
            </label>
            <div className="relative">
              <Input
                type={field.secret && !visibleSecrets[field.key] ? 'password' : 'text'}
                value={fieldValues[field.key] ?? ''}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={() => saveField(field.key, fieldValues[field.key] ?? '')}
                placeholder={field.placeholder}
                className={`h-8 text-sm ${field.secret ? 'pr-8' : ''}`}
              />
              {field.secret && (
                <button
                  type="button"
                  className="-translate-y-1/2 absolute top-1/2 right-2 flex items-center text-foreground-muted hover:text-foreground"
                  aria-label={t(
                    visibleSecrets[field.key]
                      ? 'settings.provider.api_key.hide_key'
                      : 'settings.provider.api_key.show_key'
                  )}
                  onClick={() => setVisibleSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}>
                  {visibleSecrets[field.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          </div>
        ))}
        {extraContent}
        <div className={chatIdsConfig.fullWidth ? 'col-span-2' : ''}>
          <label className="mb-1 flex items-center gap-1 font-normal text-xs">
            {chatIdsConfig.label}
            <InfoTooltip
              content={
                <div className="flex flex-col gap-1.5">
                  <span>{chatIdsConfig.hint}</span>
                  {idsKey === 'allowed_chat_ids' && <span>{t('agent.channels.chatIdsAutoTrackHint')}</span>}
                </div>
              }
              iconProps={{ size: 12, className: 'shrink-0 cursor-pointer text-foreground-muted' }}
            />
          </label>
          <Input
            value={chatIds}
            onChange={(e) => setChatIds(e.target.value)}
            onBlur={saveChatIds}
            placeholder={chatIdsConfig.placeholder}
            className="h-8 text-sm"
          />
          {chatIdsConfig.extraHint && (
            <Alert
              type="info"
              showIcon
              message={<span className="font-normal">{chatIdsConfig.extraHint}</span>}
              className="mt-1.5 gap-2 border-[var(--color-info-border)] px-2.5 py-2 text-xs shadow-none [&_svg]:size-3.5"
            />
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
          label: t('agent.channels.telegram.botToken'),
          placeholder: '123456789:xxxxxxxxxxxxxxxxxxxxxxxxxxx',
          hint: t('agent.channels.telegram.botTokenPlaceholder'),
          secret: true
        }
      ]}
      chatIds={{
        label: t('agent.channels.telegram.chatIds'),
        placeholder: t('agent.channels.telegram.chatIdsPlaceholder'),
        hint: t('agent.channels.telegram.chatIdsHint')
      }}
    />
  )
}

const FeishuDomainSelector: FC<ChannelFormProps> = ({ channel, onConfigChange }) => {
  const { t } = useTranslation()
  const cfg = channel.config
  return (
    <div>
      <label className="mb-1 block font-normal text-xs">{t('agent.channels.feishu.domain')}</label>
      <Select
        value={(cfg.domain as FeishuDomain) ?? 'feishu'}
        onValueChange={(value) => onConfigChange({ config: { ...cfg, domain: value as FeishuDomain } })}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="feishu">{t('agent.channels.feishu.domainFeishu')}</SelectItem>
          <SelectItem value="lark">{t('agent.channels.feishu.domainLark')}</SelectItem>
        </SelectContent>
      </Select>
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

  useIpcOn('channel.feishu.qr_login', (data) => {
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

  return (
    <div className="flex flex-col gap-3">
      {!hasCredentials && (
        <>
          {status === 'idle' && (
            <Alert
              type="info"
              showIcon
              message={<span className="font-normal">{t('agent.channels.feishu.loginHint')}</span>}
              className="gap-2 border-[var(--color-info-border)] px-2.5 py-2 text-xs shadow-none [&_svg]:size-3.5"
            />
          )}
          {(status === 'pending' || status === 'expired') && (
            <div className="flex items-center gap-2">
              {status === 'pending' && <span className="text-info text-xs">{t('agent.channels.feishu.qrHint')}</span>}
              {status === 'expired' && (
                <>
                  <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
                  <span className="text-destructive text-xs">{t('agent.channels.feishu.qrExpired')}</span>
                </>
              )}
            </div>
          )}
        </>
      )}
      {hasCredentials && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-success" />
          <span className="text-success text-xs">{t('agent.channels.feishu.connected')}</span>
        </div>
      )}
      <ChannelFieldsForm
        channel={channel}
        onConfigChange={onConfigChange}
        fields={[
          {
            key: 'app_id',
            label: t('agent.channels.feishu.appId'),
            placeholder: t('agent.channels.feishu.appIdPlaceholder')
          },
          {
            key: 'app_secret',
            label: t('agent.channels.feishu.appSecret'),
            placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx',
            hint: t('agent.channels.feishu.appSecretPlaceholder'),
            secret: true
          },
          {
            key: 'encrypt_key',
            label: t('agent.channels.feishu.encryptKey'),
            placeholder: 'xxxxxxxxxxxxxxxx',
            hint: t('agent.channels.feishu.encryptKeyPlaceholder'),
            secret: true
          },
          {
            key: 'verification_token',
            label: t('agent.channels.feishu.verificationToken'),
            placeholder: 'xxxxxxxxxxxxxxxx',
            hint: t('agent.channels.feishu.verificationTokenPlaceholder'),
            secret: true
          }
        ]}
        extraContent={<FeishuDomainSelector channel={channel} onConfigChange={onConfigChange} />}
        chatIds={{
          label: t('agent.channels.feishu.chatIds'),
          placeholder: t('agent.channels.feishu.chatIdsPlaceholder'),
          hint: t('agent.channels.feishu.chatIdsHint')
        }}
      />

      <Dialog
        open={!!qrUrl}
        onOpenChange={(open) => {
          if (open) return
          setQrUrl(null)
          if (status === 'pending') setStatus('idle')
        }}>
        <DialogContent closeOnOverlayClick={false} className="max-w-90">
          <DialogHeader>
            <DialogTitle>{t('agent.channels.feishu.qrTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrUrl && <QRCodeSVG value={qrUrl} size={240} level="M" />}
            <span className="text-center text-muted-foreground text-xs">{t('agent.channels.feishu.qrScanHint')}</span>
          </div>
        </DialogContent>
      </Dialog>
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
          label: t('agent.channels.discord.botToken'),
          placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          hint: t('agent.channels.discord.botTokenPlaceholder'),
          secret: true,
          span: 2
        }
      ]}
      chatIds={{
        label: t('agent.channels.discord.channelIds'),
        placeholder: t('agent.channels.discord.channelIdsPlaceholder'),
        hint: t('agent.channels.discord.channelIdsHint'),
        extraHint: t('agent.channels.discord.whoamiTip'),
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
          label: t('agent.channels.qq.appId'),
          placeholder: '123456789',
          hint: t('agent.channels.qq.appIdPlaceholder')
        },
        {
          key: 'client_secret',
          label: t('agent.channels.qq.clientSecret'),
          placeholder: 'xxxxxxxxxxxxxxxx',
          hint: t('agent.channels.qq.clientSecretPlaceholder'),
          secret: true
        }
      ]}
      chatIds={{
        label: t('agent.channels.qq.chatIds'),
        placeholder: t('agent.channels.qq.chatIdsPlaceholder'),
        hint: t('agent.channels.qq.chatIdsHint'),
        extraHint: t('agent.channels.qq.whoamiTip'),
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
    void ipcApi.request('channel.wechat.has_credentials', channel.id).then((result) => {
      if (result.exists) {
        setStatus('confirmed')
        if (result.userId) setLoginUserId(result.userId)
      }
    })
  }, [channel.id])

  useIpcOn('channel.wechat.qr_login', (data) => {
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {(status === 'idle' || status === 'pending') && (
          <Alert
            type="info"
            showIcon
            message={<span className="font-normal">{t('agent.channels.wechat.loginHint')}</span>}
            className="gap-2 border-[var(--color-info-border)] px-2.5 py-2 text-xs shadow-none [&_svg]:size-3.5"
          />
        )}
        {(status === 'confirmed' || status === 'disconnected') && (
          <div className="flex items-center gap-2">
            {status === 'confirmed' && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
                <span className="text-success text-xs">{t('agent.channels.wechat.connected')}</span>
              </>
            )}
            {status === 'disconnected' && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
                <span className="text-destructive text-xs">{t('agent.channels.wechat.disconnected')}</span>
              </>
            )}
          </div>
        )}
        {loginUserId && status === 'confirmed' && (
          <span className="text-gray-400 text-xs">
            User ID: <code className="select-all rounded bg-gray-100 px-1 dark:bg-gray-800">{loginUserId}</code>
          </span>
        )}
      </div>

      <ChannelPermissionMode channel={channel} onConfigChange={onConfigChange} />

      <Dialog
        open={!!qrUrl}
        onOpenChange={(open) => {
          if (open) return
          setQrUrl(null)
          if (status !== 'confirmed' && onRemove) onRemove()
        }}>
        <DialogContent closeOnOverlayClick={false} className="max-w-90">
          <DialogHeader>
            <DialogTitle>{t('agent.channels.wechat.qrTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrUrl && <QRCodeSVG value={qrUrl} size={240} level="M" />}
            <span className="text-center text-muted-foreground text-xs">{t('agent.channels.wechat.qrHint')}</span>
          </div>
        </DialogContent>
      </Dialog>
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
          label: t('agent.channels.slack.botToken'),
          placeholder: t('agent.channels.slack.botTokenPlaceholder'),
          secret: true,
          span: 2
        },
        {
          key: 'app_token',
          label: t('agent.channels.slack.appToken'),
          placeholder: t('agent.channels.slack.appTokenPlaceholder'),
          secret: true,
          span: 2
        }
      ]}
      chatIds={{
        label: t('agent.channels.slack.channelIds'),
        placeholder: t('agent.channels.slack.channelIdsPlaceholder'),
        hint: t('agent.channels.slack.channelIdsHint'),
        extraHint: t('agent.channels.slack.whoamiTip'),
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
