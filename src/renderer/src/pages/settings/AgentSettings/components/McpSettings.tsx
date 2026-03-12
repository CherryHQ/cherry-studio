import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { UpdateAgentBaseForm } from '@renderer/types'
import type { CardProps } from 'antd'
import { Card, Switch, Tooltip } from 'antd'
import { Wrench } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

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

export const McpSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const { mcpServers: allServers } = useMCPServers()
  const [isUpdatingMcp, setIsUpdatingMcp] = useState(false)

  const selectedMcpIds = useMemo(() => agentBase?.mcps ?? [], [agentBase?.mcps])
  const availableServers = useMemo(() => allServers ?? [], [allServers])

  const handleToggleMcp = useCallback(
    async (serverId: string, enabled: boolean) => {
      if (!agentBase || isUpdatingMcp) {
        return
      }
      const exists = selectedMcpIds.includes(serverId)
      if (enabled === exists) {
        return
      }
      const next = enabled ? [...selectedMcpIds, serverId] : selectedMcpIds.filter((id) => id !== serverId)

      setIsUpdatingMcp(true)
      try {
        await update({ id: agentBase.id, mcps: next } satisfies UpdateAgentBaseForm)
      } finally {
        setIsUpdatingMcp(false)
      }
    },
    [agentBase, isUpdatingMcp, selectedMcpIds, update]
  )

  if (!agentBase) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.settings.toolsMcp.mcp.title', 'MCP Servers')}</SettingsTitle>
        <div className="flex flex-col gap-3">
          <span className="text-foreground-500 text-sm">
            {t(
              'agent.settings.tooling.mcp.description',
              'Connect MCP servers to unlock additional tools you can approve above.'
            )}
          </span>
          {availableServers.length === 0 ? (
            <div className="rounded-medium border border-default-200 border-dashed px-4 py-6 text-center text-foreground-500 text-sm">
              {t('agent.settings.tooling.mcp.empty', 'No MCP servers detected. Add one from the MCP settings page.')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {availableServers.map((server) => {
                const isSelected = selectedMcpIds.includes(server.id)
                return (
                  <Card
                    key={server.id}
                    className="border border-default-200"
                    title={
                      <div className="flex items-center justify-between gap-2 py-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            {server.logoUrl && (
                              <img
                                src={server.logoUrl}
                                alt={`${server.name} logo`}
                                className="h-5 w-5 rounded object-cover"
                              />
                            )}
                            <span className="truncate font-medium text-sm">{server.name}</span>
                          </div>
                          {server.description ? (
                            <span className="line-clamp-2 whitespace-pre-wrap break-all text-foreground-500 text-xs">
                              {server.description}
                            </span>
                          ) : null}
                        </div>
                        <Tooltip
                          title={!server.isActive ? t('agent.settings.tooling.mcp.inactiveTooltip') : undefined}
                          open={!server.isActive ? undefined : false}>
                          <Switch
                            aria-label={t('agent.settings.tooling.mcp.toggle', {
                              defaultValue: `Toggle ${server.name}`,
                              name: server.name
                            })}
                            checked={isSelected}
                            size="small"
                            disabled={!server.isActive || isUpdatingMcp}
                            onChange={(checked) => handleToggleMcp(server.id, checked)}
                          />
                        </Tooltip>
                      </div>
                    }
                    styles={cardStyles}
                  />
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-2 text-foreground-500 text-xs">
            <Wrench size={14} />
            <span>
              {t('agent.settings.tooling.mcp.manageHint', 'Need advanced configuration? Visit Settings → MCP Servers.')}
            </span>
          </div>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default McpSettings
