import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch
} from '@cherrystudio/ui'
import { ChannelConfigDialog } from '@renderer/components/channel/ChannelConfigDialog'
import { ChannelQrLoginDialog } from '@renderer/components/channel/ChannelQrLoginDialog'
import { channelSummary } from '@renderer/components/channel/channelSummary'
import {
  CHANNEL_MENU_PLATFORMS,
  type ChannelData,
  type ChannelUpdates
} from '@renderer/components/channel/channelTypes'
import { useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import {
  type AgentChannelEntity,
  isQrLoginChannel,
  type UpdateAgentChannelDto
} from '@shared/data/api/schemas/agentChannels'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentType } from '@shared/data/types/agent'

/**
 * The channels bound to one Agent. Channels added here are bound to it in the system workspace;
 * every change goes through the same channel commands as Settings › Channels.
 */
export function AgentChannelsPage({
  agentId,
  agentType,
  permissionMode,
  portalContainer
}: {
  agentId: string
  agentType: AgentType
  permissionMode: AgentPermissionMode
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { channels, createChannel, updateChannel, deleteChannel } = useChannels({ agentId })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loginId, setLoginId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AgentChannelEntity | null>(null)
  const editing = channels.find((channel) => channel.id === editingId) ?? null
  // Stable per refetch: the dialog re-reads the name whenever this object changes.
  const editingData = useMemo<ChannelData | null>(
    () =>
      editing && {
        id: editing.id,
        type: editing.type,
        name: editing.name,
        agentId: editing.agentId,
        workspace: editing.workspace,
        config: editing.config,
        isActive: editing.isActive,
        permissionMode: editing.permissionMode
      },
    [editing]
  )
  const login = channels.find((channel) => channel.id === loginId)
  const statuses = useSharedCacheSelector(
    channels.map((channel) => `channel.status.${channel.id}` as const),
    (values) => values.map((status) => status?.connected ?? false)
  )

  const add = async (platform: (typeof CHANNEL_MENU_PLATFORMS)[number]) => {
    const title = t(platform.titleKey)
    const sameType = channels.filter((channel) => channel.type === platform.type).length
    // Created inactive: credential platforms need their fields, QR platforms log in from this page.
    const created = await createChannel({
      type: platform.type,
      name: sameType ? `${title} ${sameType + 1}` : title,
      agentId,
      workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM },
      config: platform.defaultConfig,
      isActive: false,
      permissionMode: null
    } as never)
    if (created) setEditingId(created.id)
  }
  // The fields Settings › Channels forwards; the forms hold loose config that the main process validates.
  const update = (id: string, { name, configPatch, config, isActive, permissionMode }: ChannelUpdates) =>
    void updateChannel(id, { name, configPatch, config, isActive, permissionMode } as UpdateAgentChannelDto)

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
            {CHANNEL_MENU_PLATFORMS.map((platform) => (
              <DropdownMenuItem key={platform.type} onSelect={() => void add(platform)}>
                <img src={getChannelTypeIcon(platform.type)} alt="" className="size-4 rounded object-contain" />
                {t(platform.titleKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {channels.length === 0 ? (
        <p className="rounded-md border border-border-subtle border-dashed px-4 py-6 text-center text-foreground-tertiary text-xs">
          {t('library.config.dialogs.create.channels.empty', {
            platforms: CHANNEL_MENU_PLATFORMS.map((platform) => t(platform.titleKey)).join(
              t('library.config.dialogs.create.result.list_separator')
            )
          })}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          {channels.map((channel, index) => {
            const qrPending = isQrLoginChannel(channel) && !channel.isActive
            return (
              <div
                key={channel.id}
                className="flex min-w-0 items-center gap-2.5 rounded-md border border-border-subtle bg-accent/15 px-2.5 py-2">
                <img src={getChannelTypeIcon(channel.type)} alt="" className="size-5 shrink-0 rounded object-contain" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-foreground text-sm">
                    {channel.name}
                    {channel.isActive && statuses[index] ? (
                      <Badge className="border-success-border bg-success-subtle px-1.5 py-0 text-[10px] text-success-subtle-foreground leading-3.5">
                        {t('agent.channels.connected')}
                      </Badge>
                    ) : qrPending ? (
                      <Badge
                        variant="secondary"
                        className="border-0 bg-secondary px-1.5 py-0 font-normal text-[10px] text-muted-foreground leading-3.5">
                        {t('library.config.dialogs.create.channels.qr_pending')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">
                    {channelSummary(t, channel, permissionMode)}
                  </div>
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
                  onClick={() => setDeleting(channel)}
                  className="size-7 text-muted-foreground hover:text-destructive!">
                  <Trash2 className="size-3.5" />
                </Button>
                <Switch
                  size="sm"
                  aria-label={`${t('common.enabled')} ${channel.name}`}
                  checked={channel.isActive}
                  // Switching a QR channel on is its login, which runs in the QR dialog.
                  onCheckedChange={(isActive) =>
                    isActive && qrPending ? setLoginId(channel.id) : void updateChannel(channel.id, { isActive })
                  }
                />
              </div>
            )
          })}
        </div>
      )}

      <ChannelConfigDialog
        open={Boolean(editing)}
        channel={editingData}
        agentPermissionMode={permissionMode}
        permissionModes={AGENT_RUNTIME_CAPABILITIES[agentType].permissionModes}
        onClose={() => setEditingId(null)}
        onConfigChange={(updates) => editing && update(editing.id, updates)}
        footer={
          editing && isQrLoginChannel(editing) && !editing.isActive ? (
            <div className="flex shrink-0 justify-end pt-1">
              <Button
                type="button"
                variant="emphasis"
                onClick={() => {
                  setLoginId(editing.id)
                  setEditingId(null)
                }}>
                {t('library.config.dialogs.create.result.qr_login')}
              </Button>
            </div>
          ) : undefined
        }
      />
      {login && (login.type === 'wechat' || login.type === 'feishu') ? (
        <ChannelQrLoginDialog
          channel={{ id: login.id, type: login.type }}
          onActiveChange={(isActive) => updateChannel(login.id, { isActive })}
          onClose={() => setLoginId(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('agent.channels.deleteConfirm', { name: deleting?.name ?? '' })}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (deleting) void deleteChannel(deleting.id)
          setDeleting(null)
        }}
      />
    </div>
  )
}
