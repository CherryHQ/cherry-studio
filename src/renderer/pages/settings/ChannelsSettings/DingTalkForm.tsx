import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Input, Label } from '@cherrystudio/ui'

import { ChannelQrRegistration } from './ChannelQrRegistration'
import type { ChannelData } from './channelTypes'

export function DingTalkForm({
  channel,
  onConfigChange
}: {
  channel: ChannelData
  onConfigChange: (updates: Partial<ChannelData>) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const fields = [
    { key: 'client_id', label: t('agent.channels.dingtalk.clientId') },
    { key: 'robot_code', label: t('agent.channels.dingtalk.robotCode') },
    { key: 'client_secret', label: t('agent.channels.dingtalk.clientSecret'), secret: true },
    { key: 'card_template_id', label: t('agent.channels.dingtalk.cardTemplateId') },
    { key: 'allowed_chat_ids', label: t('agent.channels.dingtalk.chatIds'), list: true },
    { key: 'allowed_user_ids', label: t('agent.channels.dingtalk.userIds'), list: true }
  ]
  return (
    <div className="flex flex-col gap-3">
      <ChannelQrRegistration channel={channel} />
      <p className="text-xs text-muted-foreground">{t('agent.channels.dingtalk.setupHint')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => {
          const value = field.list
            ? ((channel.config[field.key] as string[]) ?? []).join(', ')
            : ((channel.config[field.key] as string) ?? '')
          return (
            <div key={field.key}>
              <Label htmlFor={`${id}-${field.key}`} className="mb-1 block text-xs">
                {field.label}
              </Label>
              <Input
                key={value}
                id={`${id}-${field.key}`}
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                defaultValue={value}
                className="h-8 text-sm"
                onBlur={(event) => {
                  if (event.target.value === value) return
                  const next = field.list
                    ? [
                        ...new Set(
                          event.target.value
                            .split(',')
                            .map((part) => part.trim())
                            .filter(Boolean)
                        )
                      ]
                    : field.secret
                      ? event.target.value
                      : event.target.value.trim()
                  onConfigChange({ config: { ...channel.config, [field.key]: next } })
                }}
              />
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('agent.channels.dingtalk.allowlistHint')}</p>
      <p className="text-xs text-muted-foreground">{t('agent.channels.dingtalk.cardHint')}</p>
      <p className="text-xs text-muted-foreground">{t('agent.channels.dingtalk.privacyHint')}</p>
    </div>
  )
}
