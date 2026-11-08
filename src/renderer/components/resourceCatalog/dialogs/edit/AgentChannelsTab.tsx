import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Switch } from '@cherrystudio/ui'
import { AVAILABLE_CHANNELS, type AvailableChannel } from '@renderer/config/channelTypes'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

const AUTO_ACTIVE_CHANNEL_TYPES = new Set(['feishu', 'wechat'])

export function AgentChannelsTab({ agentId, onSettingsNavigate }: { agentId: string; onSettingsNavigate: () => void }) {
  const { t } = useTranslation()
  const { channels, isLoading, createChannel, updateChannel } = useChannels()
  const [pendingType, setPendingType] = useState<string | null>(null)

  const runBinding = async (def: AvailableChannel, bind: boolean) => {
    setPendingType(def.type)
    try {
      if (bind) {
        const unbound = channels.find((channel) => channel.type === def.type && !channel.agentId)
        if (unbound) {
          await updateChannel(unbound.id, { agentId })
        } else {
          const existingCount = channels.filter((channel) => channel.type === def.type).length
          await createChannel({
            type: def.type,
            name: existingCount > 0 ? `${def.name} ${existingCount + 1}` : def.name,
            agentId,
            workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM },
            config: def.defaultConfig,
            isActive: AUTO_ACTIVE_CHANNEL_TYPES.has(def.type)
          } as never)
        }
      } else {
        const bound = channels.filter((channel) => channel.type === def.type && channel.agentId === agentId)
        await Promise.all(bound.map((channel) => updateChannel(channel.id, { agentId: null })))
      }
    } finally {
      setPendingType(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-muted-foreground text-xs">{t('agent.channels.agentTab.description')}</p>
      {AVAILABLE_CHANNELS.filter((def) => def.available).map((def) => {
        const bound = channels.filter((channel) => channel.type === def.type && channel.agentId === agentId)
        const icon = getChannelTypeIcon(def.type)
        const needsSetup = bound.some((channel) => !channel.isActive)
        return (
          <div key={def.type} className="flex flex-col gap-2 rounded-lg border border-border-subtle px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {icon && <img src={icon} alt="" className="h-4 w-4 rounded-sm object-contain" />}
                <span className="truncate text-sm">{def.name}</span>
              </div>
              <Switch
                size="sm"
                checked={bound.length > 0}
                disabled={isLoading || pendingType !== null}
                onCheckedChange={(checked) => void runBinding(def, checked)}
                aria-label={def.name}
              />
            </div>
            {bound.length > 0 ? (
              <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
                {needsSetup ? <span>{t('agent.channels.agentTab.inactiveHint')}</span> : <span />}
                <Button variant="ghost" size="sm" onClick={onSettingsNavigate}>
                  {t('agent.channels.agentTab.openSettings')}
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
