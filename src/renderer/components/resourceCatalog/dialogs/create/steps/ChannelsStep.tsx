import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch
} from '@cherrystudio/ui'
import { ChannelConfigDialog } from '@renderer/components/channel/ChannelConfigDialog'
import {
  type ChannelDraftItem,
  createChannelDraft,
  toAgentChannelDraft
} from '@renderer/components/channel/channelDraft'
import { AVAILABLE_CHANNELS, type ChannelUpdates } from '@renderer/components/channel/channelTypes'
import { permissionModeCards } from '@renderer/utils/agent'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { type AgentChannelType, isQrLoginChannel } from '@shared/data/api/schemas/agentChannels'

import type { ResourceCreateWizardFormValues } from '../types'

// The create menu leads with the platforms most users connect first.
const PLATFORM_ORDER: AgentChannelType[] = [
  'wechat',
  'feishu',
  'wecom',
  'dingtalk',
  'qq',
  'telegram',
  'discord',
  'slack'
]
const PLATFORMS = PLATFORM_ORDER.flatMap((type) => AVAILABLE_CHANNELS.filter((platform) => platform.type === type))

function applyUpdates(channel: ChannelDraftItem, updates: ChannelUpdates): ChannelDraftItem {
  const { configPatch, config, ...fields } = updates
  return {
    ...channel,
    ...fields,
    type: channel.type,
    config: configPatch ? { ...channel.config, ...configPatch } : (config ?? channel.config)
  }
}

type ChannelsStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/** Agent channels, kept as drafts and created together with the Agent. */
export function ChannelsStep({ form, portalContainer }: ChannelsStepProps) {
  const { t } = useTranslation()
  const [channels, agentType, permissionMode] = useWatch({
    control: form.control,
    name: ['channels', 'agentType', 'permissionMode']
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = channels.find((channel) => channel.id === editingId) ?? null
  const caps = AGENT_RUNTIME_CAPABILITIES[agentType]
  const separator = t('library.config.dialogs.create.result.list_separator')

  const setChannels = (next: ChannelDraftItem[]) => form.setValue('channels', next, { shouldDirty: true })
  const update = (id: string, updates: ChannelUpdates) =>
    setChannels(
      form.getValues('channels').map((channel) => (channel.id === id ? applyUpdates(channel, updates) : channel))
    )
  const remove = (id: string) => {
    setChannels(form.getValues('channels').filter((channel) => channel.id !== id))
    if (id === editingId) setEditingId(null)
  }

  const modeTitle = (mode: string | null | undefined) => {
    const card = permissionModeCards.find((item) => item.mode === mode)
    return card ? t(card.titleKey, card.titleFallback) : ''
  }
  const summary = (channel: ChannelDraftItem) => {
    const ids = (channel.config.allowed_chat_ids ?? channel.config.allowed_channel_ids ?? []) as string[]
    return [
      channel.type === 'feishu'
        ? t(
            channel.config.domain === 'lark' ? 'agent.channels.feishu.domainLark' : 'agent.channels.feishu.domainFeishu'
          )
        : null,
      ids.length
        ? t('library.config.dialogs.create.channels.chats_count', { count: ids.length })
        : t('library.config.dialogs.create.channels.chats_all'),
      channel.permissionMode
        ? t('library.config.dialogs.create.channels.permission', { mode: modeTitle(channel.permissionMode) })
        : t('library.config.dialogs.create.channels.permission_inherit', { mode: modeTitle(permissionMode) })
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">{t('library.config.dialogs.create.channels.intro')}</span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="h-8 shrink-0">
              <Plus size={13} />
              {t('library.config.dialogs.create.channels.add')}
              <ChevronDown size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44" portalContainer={portalContainer}>
            {PLATFORMS.map((platform) => (
              <DropdownMenuItem
                key={platform.type}
                onSelect={() => {
                  const created = createChannelDraft(platform, t(platform.titleKey), form.getValues('channels'))
                  setChannels([...form.getValues('channels'), created])
                  setEditingId(created.id)
                }}>
                <img src={getChannelTypeIcon(platform.type)} alt="" className="size-4 rounded object-contain" />
                {t(platform.titleKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {channels.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle border-dashed px-4 py-6">
          <div className="flex items-center gap-2">
            {PLATFORMS.slice(0, 6).map((platform) => (
              <img
                key={platform.type}
                src={getChannelTypeIcon(platform.type)}
                alt=""
                className="size-6 rounded-md object-contain opacity-80"
              />
            ))}
          </div>
          <p className="text-center text-foreground-tertiary text-xs">
            {t('library.config.dialogs.create.channels.empty', {
              platforms: PLATFORMS.map((platform) => t(platform.titleKey)).join(separator)
            })}
          </p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          {channels.map((channel) => {
            const qrPending = isQrLoginChannel(channel)
            const valid = toAgentChannelDraft(channel) !== null
            return (
              <div
                key={channel.id}
                className="flex min-w-0 items-center gap-2.5 rounded-md border border-border-subtle bg-accent/15 px-2.5 py-2">
                <img src={getChannelTypeIcon(channel.type)} alt="" className="size-5 shrink-0 rounded object-contain" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-foreground text-sm">
                    {channel.name}
                    {qrPending ? (
                      <Badge
                        variant="secondary"
                        className="border-0 bg-secondary px-1.5 py-0 font-normal text-[10px] text-muted-foreground leading-3.5">
                        {t('library.config.dialogs.create.channels.qr_pending')}
                      </Badge>
                    ) : null}
                  </div>
                  {valid ? (
                    <div className="truncate text-muted-foreground text-xs">{summary(channel)}</div>
                  ) : (
                    <div role="alert" className="truncate text-warning text-xs">
                      {t('library.config.dialogs.create.channels.invalid')}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${t('common.edit')} ${channel.name}`}
                  onClick={() => setEditingId(channel.id)}
                  className="size-7 text-muted-foreground">
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${t('common.delete')} ${channel.name}`}
                  onClick={() => remove(channel.id)}
                  className="size-7 text-muted-foreground hover:text-destructive!">
                  <Trash2 className="size-3.5" />
                </Button>
                <Switch
                  size="sm"
                  aria-label={`${t('common.enabled')} ${channel.name}`}
                  // QR-login channels start inactive; their login runs after the Agent is created.
                  checked={!qrPending && channel.isActive}
                  disabled={qrPending}
                  onCheckedChange={(isActive) => update(channel.id, { isActive })}
                />
              </div>
            )
          })}
        </div>
      )}

      <ChannelConfigDialog
        open={Boolean(editing)}
        channel={editing}
        draft
        agentPermissionMode={permissionMode}
        permissionModes={caps.permissionModes}
        onClose={() => setEditingId(null)}
        onConfigChange={(updates) => editing && update(editing.id, updates)}
        footer={
          <div className="flex shrink-0 items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive!"
              onClick={() => editing && remove(editing.id)}>
              <Trash2 className="size-3.5" />
              {t('library.config.dialogs.create.channels.delete')}
            </Button>
            <Button type="button" variant="emphasis" onClick={() => setEditingId(null)}>
              {t('library.config.dialogs.create.channels.done')}
            </Button>
          </div>
        }
      />
    </div>
  )
}
