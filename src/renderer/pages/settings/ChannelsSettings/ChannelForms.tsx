import { QRCodeSVG } from 'qrcode.react'
import type { ReactNode } from 'react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import { PermissionModeSelectItem } from '@renderer/components/PermissionModeOption'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { FeishuChannelConfig, FeishuDomain, PermissionMode } from '@renderer/types/agent'
import { permissionModeCards } from '@renderer/utils/agent'

import type { ChannelData } from './channelTypes'

// --------------- Permission mode ---------------

const INHERIT_PERMISSION_MODE_VALUE = '__inherit'

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
  const selectedCard = permissionModeCards.find((card) => card.mode === channel.permissionMode)
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{t('agent.channels.security.permissionMode')}</Label>
      <Select
        value={channel.permissionMode ?? INHERIT_PERMISSION_MODE_VALUE}
        onValueChange={(value) =>
          onConfigChange({
            permissionMode: value === INHERIT_PERMISSION_MODE_VALUE ? null : (value as PermissionMode)
          })
        }>
        <SelectTrigger size="sm" className="w-full">
          {/* Own children so the trigger stays one line: the items below can be two. */}
          <SelectValue>
            {selectedCard ? (
              <span className={selectedCard.dangerous ? 'text-destructive' : undefined}>
                {t(selectedCard.titleKey, selectedCard.titleFallback)}
              </span>
            ) : (
              t('agent.channels.security.inheritFromAgent')
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT_PERMISSION_MODE_VALUE}>{t('agent.channels.security.inheritFromAgent')}</SelectItem>
          {permissionModeCards.map((card) => (
            <PermissionModeSelectItem key={card.mode} card={card} compact t={t} />
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

  useEffect(() => {
    setFieldValues(Object.fromEntries(fields.map((f) => [f.key, (cfg[f.key] as string) ?? ''])))
    setChatIds(((cfg[idsKey] as string[]) ?? []).join(', '))
    // oxlint-disable-next-line react/exhaustive-deps
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
            <Label className="mb-1 block text-xs">{field.label}</Label>
            {field.secret ? (
              <Input
                type="password"
                value={fieldValues[field.key] ?? ''}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={() => saveField(field.key, fieldValues[field.key] ?? '')}
                placeholder={field.placeholder}
                className="h-8 text-sm"
              />
            ) : (
              <Input
                value={fieldValues[field.key] ?? ''}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={() => saveField(field.key, fieldValues[field.key] ?? '')}
                placeholder={field.placeholder}
                className="h-8 text-sm"
              />
            )}
          </div>
        ))}
        {extraContent}
        <div className={chatIdsConfig.fullWidth ? 'col-span-2' : ''}>
          <Label className="mb-1 block text-xs">{chatIdsConfig.label}</Label>
          <Input
            value={chatIds}
            onChange={(e) => setChatIds(e.target.value)}
            onBlur={saveChatIds}
            placeholder={chatIdsConfig.placeholder}
            className="h-8 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">{chatIdsConfig.hint}</span>
          {!chatIds.trim() && idsKey === 'allowed_chat_ids' && (
            <span className="mt-1 block text-xs text-warning">{t('agent.channels.chatIdsAutoTrackHint')}</span>
          )}
          {chatIdsConfig.extraHint && <span className="mt-1 block text-xs text-info">{chatIdsConfig.extraHint}</span>}
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
          placeholder: t('agent.channels.telegram.botTokenPlaceholder'),
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
      <Label className="mb-1 block text-xs">{t('agent.channels.feishu.domain')}</Label>
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

type FeishuStatus = 'idle' | 'pending' | 'confirmed' | 'expired' | 'disconnected' | 'error'

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
    } else if (data.status === 'expired') {
      setQrUrl(null)
      setStatus('expired')
    } else if (data.status === 'error') {
      setQrUrl(null)
      setStatus('error')
    } else if (data.url) {
      setQrUrl(data.url)
      setStatus('pending')
    }
  })

  return (
    <div className="flex flex-col gap-3">
      {!hasCredentials && (
        <div className="flex items-center gap-2">
          {status === 'pending' && <span className="text-xs text-info">{t('agent.channels.feishu.qrHint')}</span>}
          {status === 'expired' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-error" />
              <span className="text-xs text-error">{t('agent.channels.feishu.qrExpired')}</span>
            </>
          )}
          {status === 'error' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-error" />
              <span className="text-xs text-error">{t('agent.channels.error')}</span>
            </>
          )}
          {status === 'idle' && <span className="text-xs text-info">{t('agent.channels.feishu.loginHint')}</span>}
        </div>
      )}
      {hasCredentials && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-success" />
          <span className="text-xs text-success">{t('agent.channels.feishu.connected')}</span>
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
            placeholder: t('agent.channels.feishu.appSecretPlaceholder'),
            secret: true
          },
          {
            key: 'encrypt_key',
            label: t('agent.channels.feishu.encryptKey'),
            placeholder: t('agent.channels.feishu.encryptKeyPlaceholder'),
            secret: true
          },
          {
            key: 'verification_token',
            label: t('agent.channels.feishu.verificationToken'),
            placeholder: t('agent.channels.feishu.verificationTokenPlaceholder'),
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
            <span className="text-center text-xs text-muted-foreground">{t('agent.channels.feishu.qrScanHint')}</span>
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
          placeholder: t('agent.channels.discord.botTokenPlaceholder'),
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
  const cfg = channel.config
  const mentionOnly = (cfg.mention_only as boolean) ?? true

  return (
    <ChannelFieldsForm
      channel={channel}
      onConfigChange={onConfigChange}
      fields={[
        {
          key: 'app_id',
          label: t('agent.channels.qq.appId'),
          placeholder: t('agent.channels.qq.appIdPlaceholder')
        },
        {
          key: 'client_secret',
          label: t('agent.channels.qq.clientSecret'),
          placeholder: t('agent.channels.qq.clientSecretPlaceholder'),
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
      extraContent={
        <div className="col-span-2 flex items-center gap-3 pt-1">
          <Switch
            checked={mentionOnly}
            onCheckedChange={(checked) => onConfigChange({ config: { ...cfg, mention_only: checked } })}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">{t('agent.channels.qq.mentionOnlyLabel')}</span>
            <span className="text-muted-foreground text-xs">{t('agent.channels.qq.mentionOnlyHint')}</span>
          </div>
        </div>
      }
    />
  )
}

type WeChatStatus = 'idle' | 'pending' | 'confirmed' | 'expired' | 'disconnected' | 'error'

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
      setStatus('expired')
    } else if (data.status === 'disconnected') {
      setStatus('disconnected')
      setLoginUserId(null)
    } else if (data.status === 'error') {
      setQrUrl(null)
      setStatus('error')
    } else if (data.url) {
      setQrUrl(data.url)
      setStatus('pending')
    }
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {status === 'confirmed' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-success" />
              <span className="text-xs text-success">{t('agent.channels.wechat.connected')}</span>
            </>
          )}
          {status === 'disconnected' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-error" />
              <span className="text-xs text-error">{t('agent.channels.wechat.disconnected')}</span>
            </>
          )}
          {status === 'expired' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-error" />
              <span className="text-xs text-error">{t('agent.channels.wechat.qrExpired')}</span>
            </>
          )}
          {status === 'error' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-error" />
              <span className="text-xs text-error">{t('agent.channels.error')}</span>
            </>
          )}
          {(status === 'idle' || status === 'pending') && (
            <span className="text-xs text-info">{t('agent.channels.wechat.loginHint')}</span>
          )}
        </div>
        {loginUserId && status === 'confirmed' && (
          <span className="text-xs text-foreground-tertiary">
            User ID: <code className="rounded bg-muted px-1 select-all">{loginUserId}</code>
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
            <span className="text-center text-xs text-muted-foreground">{t('agent.channels.wechat.qrHint')}</span>
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
