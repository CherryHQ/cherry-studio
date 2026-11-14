import { QrCode } from 'lucide-react'
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
  SegmentedControl,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { FeishuChannelConfig, FeishuDomain } from '@renderer/types/agent'

import { ChannelPermissionMode } from './ChannelPermissionMode'
import type { ChannelFormProps } from './channelTypes'
import { DingTalkForm } from './DingTalkForm'
import { WeComForm } from './WeComForm'

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
  configKey?: string
}

type ChannelFieldsFormProps = ChannelFormProps & {
  fields: FieldDef[]
  chatIds: ChatIdsConfig
  extraContent?: ReactNode
  patchConfig?: boolean
}

// --------------- Shared form components ---------------

const ChannelFieldsForm: FC<ChannelFieldsFormProps> = ({
  fields,
  chatIds: chatIdsConfig,
  extraContent,
  patchConfig,
  ...props
}) => {
  const { channel, onConfigChange } = props
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
        onConfigChange(patchConfig ? { configPatch: { [key]: trimmed } } : { config: { ...cfg, [key]: trimmed } })
      }
    },
    [cfg, onConfigChange, patchConfig]
  )

  const saveChatIds = useCallback(() => {
    const ids = chatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (JSON.stringify(ids) !== JSON.stringify((cfg[idsKey] as string[]) ?? [])) {
      onConfigChange(patchConfig ? { configPatch: { [idsKey]: ids } } : { config: { ...cfg, [idsKey]: ids } })
    }
  }, [chatIds, cfg, idsKey, onConfigChange, patchConfig])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key} className={field.span === 2 ? 'col-span-2' : ''}>
            <Label className="mb-1 block font-normal text-xs">{field.label}</Label>
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
        <div className="col-span-2">
          <Label className="mb-1 block font-normal text-xs">{chatIdsConfig.label}</Label>
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
      <ChannelPermissionMode {...props} />
    </div>
  )
}

/** Stands in for the QR code until the channel exists: its login runs after the Agent is created. */
const ChannelQrPendingNotice: FC<{ title: string }> = ({ title }) => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-md border border-border-subtle p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
        <QrCode className="size-5" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-foreground text-sm">{title}</span>
        <span className="text-muted-foreground text-xs">{t('agent.channels.qrAfterCreate')}</span>
      </div>
    </div>
  )
}

// --------------- Type-specific forms ---------------

export const TelegramForm: FC<ChannelFormProps> = (props) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsForm
      {...props}
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
      <Label className="mb-1 block font-normal text-xs">{t('agent.channels.feishu.domain')}</Label>
      <Select
        value={(cfg.domain as FeishuDomain) ?? 'feishu'}
        onValueChange={(value) => onConfigChange({ configPatch: { domain: value } })}>
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

export const FeishuForm: FC<ChannelFormProps> = (props) => {
  const { channel, onConfigChange, draft } = props
  const { t } = useTranslation()
  const cfg = channel.config as FeishuChannelConfig
  const mentionOnly = (cfg.mention_only as boolean) ?? true
  const hasCredentials = !!(cfg.app_id && cfg.app_secret)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<FeishuStatus>(hasCredentials ? 'confirmed' : 'idle')
  const [draftSetup, setDraftSetup] = useState<'qr' | 'manual'>(hasCredentials ? 'manual' : 'qr')
  const qrSetup = draft && draftSetup === 'qr'

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
      {draft && (
        <SegmentedControl
          size="sm"
          className="w-fit"
          aria-label={t('agent.channels.feishu.setup')}
          value={draftSetup}
          onValueChange={(setup) => {
            setDraftSetup(setup)
            // Registration fills the credentials, and the channel only registers while they are empty.
            if (setup === 'qr') onConfigChange({ configPatch: { app_id: '', app_secret: '' } })
          }}
          options={[
            { value: 'qr', label: t('agent.channels.feishu.setupQr') },
            { value: 'manual', label: t('agent.channels.feishu.setupManual') }
          ]}
        />
      )}
      {qrSetup && <ChannelQrPendingNotice title={t('agent.channels.feishu.qrTitle')} />}
      {!draft && !hasCredentials && (
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
      {!draft && hasCredentials && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-success" />
          <span className="text-xs text-success">{t('agent.channels.feishu.connected')}</span>
        </div>
      )}
      <ChannelFieldsForm
        {...props}
        patchConfig
        fields={
          qrSetup
            ? []
            : [
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
              ]
        }
        extraContent={
          <>
            <div className="col-span-2 flex items-center gap-3 pt-1">
              <Switch
                aria-label={t('agent.channels.feishu.mentionOnlyLabel')}
                checked={mentionOnly}
                onCheckedChange={(checked) => onConfigChange({ configPatch: { mention_only: checked } })}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{t('agent.channels.feishu.mentionOnlyLabel')}</span>
                <span className="text-muted-foreground text-xs">{t('agent.channels.feishu.mentionOnlyHint')}</span>
              </div>
            </div>
            <FeishuDomainSelector channel={channel} onConfigChange={onConfigChange} />
          </>
        }
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

export const DiscordForm: FC<ChannelFormProps> = (props) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsForm
      {...props}
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
        configKey: 'allowed_channel_ids'
      }}
    />
  )
}

export const QQForm: FC<ChannelFormProps> = (props) => {
  const { channel, onConfigChange } = props
  const { t } = useTranslation()
  const cfg = channel.config
  const mentionOnly = (cfg.mention_only as boolean) ?? true

  return (
    <ChannelFieldsForm
      {...props}
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
        extraHint: t('agent.channels.qq.whoamiTip')
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

export const WeChatForm: FC<ChannelFormProps & { onRemove?: () => void }> = ({ onRemove, ...props }) => {
  const { channel, draft } = props
  const { t } = useTranslation()
  const chatIds = (
    <ChannelFieldsForm
      {...props}
      patchConfig
      fields={[]}
      chatIds={{
        label: t('agent.channels.wechat.chatIds'),
        placeholder: t('agent.channels.wechat.chatIdsPlaceholder'),
        hint: t('agent.channels.wechat.chatIdsHint')
      }}
    />
  )
  const [status, setStatus] = useState<WeChatStatus>('idle')
  const [loginUserId, setLoginUserId] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  useEffect(() => {
    if (draft) return
    void ipcApi.request('channel.wechat.has_credentials', channel.id).then((result) => {
      if (result.exists) {
        setStatus('confirmed')
        if (result.userId) setLoginUserId(result.userId)
      }
    })
  }, [channel.id, draft])

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

  if (draft) {
    return (
      <div className="flex flex-col gap-3">
        <ChannelQrPendingNotice title={t('agent.channels.wechat.qrTitle')} />
        {chatIds}
      </div>
    )
  }

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

      {chatIds}

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

export const SlackForm: FC<ChannelFormProps> = (props) => {
  const { t } = useTranslation()
  return (
    <ChannelFieldsForm
      {...props}
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
    case 'dingtalk':
      return DingTalkForm
    case 'wecom':
      return WeComForm
    case 'wechat':
      return WeChatForm
    default:
      return null
  }
}
