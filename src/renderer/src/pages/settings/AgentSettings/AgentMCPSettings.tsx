import { Card, CardBody, CardHeader, Switch, Tooltip } from '@heroui/react'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { GetAgentResponse, UpdateAgentForm } from '@renderer/types'
import { Info } from 'lucide-react'
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

interface AgentMCPSettingsProps {
  agent: GetAgentResponse | undefined | null
  updateAgent: (form: UpdateAgentForm) => Promise<void> | void
}

export const AgentMCPSettings: React.FC<AgentMCPSettingsProps> = ({ agent, updateAgent }) => {
  const { t } = useTranslation()
  const { mcpServers: allMcpServers } = useMCPServers()
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const availableServers = useMemo(() => allMcpServers ?? [], [allMcpServers])

  useEffect(() => {
    if (!agent) {
      setSelectedIds([])
      return
    }
    const mcps = agent.mcps ?? []
    const validIds = mcps.filter((id) => availableServers.some((server) => server.id === id))
    setSelectedIds((prev) => {
      if (prev.length === validIds.length && prev.every((id) => validIds.includes(id))) {
        return prev
      }
      return validIds
    })
  }, [agent, availableServers])

  const handleToggle = useCallback(
    (serverId: string, isEnabled: boolean) => {
      if (!agent) return

      setSelectedIds((prev) => {
        const exists = prev.includes(serverId)
        if (isEnabled === exists) {
          return prev
        }
        const next = isEnabled ? [...prev, serverId] : prev.filter((id) => id !== serverId)
        updateAgent({ id: agent.id, mcps: next })
        return next
      })
    },
    [agent, updateAgent]
  )

  const enabledCount = useMemo(() => {
    const validSelected = selectedIds.filter((id) => availableServers.some((server) => server.id === id))
    return validSelected.length
  }, [selectedIds, availableServers])

  const renderServerMeta = useCallback((meta?: ReactNode) => {
    if (!meta) return null
    return <span className="text-foreground-400 text-xs">{meta}</span>
  }, [])

  if (!agent) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem divider={false} className="flex-1">
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-center justify-between">
            <SettingsTitle>
              {t('assistants.settings.mcp.title')}
              <Tooltip
                placement="right"
                content={t('assistants.settings.mcp.description', 'Select MCP servers to use with this agent')}>
                <Info size={16} className="text-foreground-400" />
              </Tooltip>
            </SettingsTitle>
            {availableServers.length > 0 ? (
              <span className="text-foreground-500 text-xs">
                {enabledCount} / {availableServers.length} {t('settings.mcp.active')}
              </span>
            ) : null}
          </div>

          {availableServers.length > 0 ? (
            <div className="flex flex-1 flex-col gap-3 overflow-auto pr-1">
              {availableServers.map((server) => {
                const isSelected = selectedIds.includes(server.id)
                return (
                  <Card key={server.id} shadow="none" className="border border-default-200">
                    <CardHeader className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate font-medium text-sm">{server.name}</span>
                        {server.description ? (
                          <span className="line-clamp-2 text-foreground-500 text-xs">{server.description}</span>
                        ) : null}
                      </div>
                      <Switch
                        aria-label={t('assistants.settings.mcp.toggle', {
                          defaultValue: `Toggle ${server.name}`
                        })}
                        isSelected={isSelected}
                        isDisabled={!server.isActive}
                        size="sm"
                        onValueChange={(value) => handleToggle(server.id, value)}
                      />
                    </CardHeader>
                    <CardBody className="gap-1 py-0 pb-3">
                      {renderServerMeta(server.baseUrl)}
                      {renderServerMeta(server.provider)}
                    </CardBody>
                  </Card>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-medium border border-default-200 border-dashed px-4 py-10 text-foreground-500 text-sm">
              {t('assistants.settings.mcp.noServersAvailable', 'No MCP servers available')}
            </div>
          )}
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentMCPSettings
