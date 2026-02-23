import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { permissionModeCards } from '@renderer/config/agent'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { UpdateAgentBaseForm } from '@renderer/types'
import type { CardProps } from 'antd'
import { Card, Switch, Tag, Tooltip } from 'antd'
import { uniq } from 'lodash'
import { Wrench } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentOrSessionSettingsProps,
  computeModeDefaults,
  defaultConfiguration,
  SettingsContainer,
  SettingsItem,
  SettingsTitle
} from '../shared'

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

const useBuiltinToolDescription = () => {
  const { t } = useTranslation()

  return (toolId: string) => {
    const descriptions: Record<string, string> = {
      Bash: t('agent.tools.builtin.Bash.description'),
      Edit: t('agent.tools.builtin.Edit.description'),
      Glob: t('agent.tools.builtin.Glob.description'),
      Grep: t('agent.tools.builtin.Grep.description'),
      MultiEdit: t('agent.tools.builtin.MultiEdit.description'),
      NotebookEdit: t('agent.tools.builtin.NotebookEdit.description'),
      NotebookRead: t('agent.tools.builtin.NotebookRead.description'),
      Read: t('agent.tools.builtin.Read.description'),
      Task: t('agent.tools.builtin.Task.description'),
      TodoWrite: t('agent.tools.builtin.TodoWrite.description'),
      WebFetch: t('agent.tools.builtin.WebFetch.description'),
      WebSearch: t('agent.tools.builtin.WebSearch.description'),
      Write: t('agent.tools.builtin.Write.description')
    }
    return descriptions[toolId]
  }
}

export const ToolsSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const getBuiltinToolDescription = useBuiltinToolDescription()
  const { mcpServers: allServers } = useMCPServers()
  const [searchTerm, setSearchTerm] = useState('')
  const [isUpdatingTools, setIsUpdatingTools] = useState(false)
  const [isUpdatingMcp, setIsUpdatingMcp] = useState(false)

  const selectedMode = useMemo(
    () => agentBase?.configuration?.permission_mode ?? defaultConfiguration.permission_mode,
    [agentBase?.configuration?.permission_mode]
  )
  const selectedModeCard = useMemo(() => permissionModeCards.find((card) => card.mode === selectedMode), [selectedMode])
  const availableTools = useMemo(() => agentBase?.tools ?? [], [agentBase?.tools])
  const autoToolIds = useMemo(() => computeModeDefaults(selectedMode, availableTools), [availableTools, selectedMode])
  const approvedToolIds = useMemo(() => {
    const allowed = agentBase?.allowed_tools ?? []
    const sanitized = allowed.filter((id) => availableTools.some((tool) => tool.id === id))
    const merged = uniq([...sanitized, ...autoToolIds])
    return merged
  }, [agentBase?.allowed_tools, autoToolIds, availableTools])
  const selectedMcpIds = useMemo(() => agentBase?.mcps ?? [], [agentBase?.mcps])

  const availableServers = useMemo(() => allServers ?? [], [allServers])

  const filteredTools = useMemo(() => {
    if (!searchTerm.trim()) {
      return availableTools
    }
    const term = searchTerm.trim().toLowerCase()
    return availableTools.filter((tool) => {
      return (
        tool.name.toLowerCase().includes(term) ||
        (tool.description ? tool.description.toLowerCase().includes(term) : false)
      )
    })
  }, [availableTools, searchTerm])

  const handleToggleTool = useCallback(
    async (toolId: string, isApproved: boolean) => {
      if (!agentBase || isUpdatingTools) {
        return
      }

      const exists = approvedToolIds.includes(toolId)
      if (isApproved === exists) {
        return
      }
      setIsUpdatingTools(true)
      const next = isApproved ? [...approvedToolIds, toolId] : approvedToolIds.filter((id) => id !== toolId)
      const sanitized = uniq(next.filter((id) => availableTools.some((tool) => tool.id === id)).concat(autoToolIds))
      try {
        await update({ id: agentBase.id, allowed_tools: sanitized } satisfies UpdateAgentBaseForm)
      } finally {
        setIsUpdatingTools(false)
      }
    },
    [agentBase, isUpdatingTools, approvedToolIds, autoToolIds, availableTools, update]
  )

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
        <SettingsTitle
          contentAfter={
            <CollapsibleSearchBar
              onSearch={setSearchTerm}
              placeholder={t('agent.settings.tooling.preapproved.search', 'Search tools')}
              tooltip={t('agent.settings.tooling.preapproved.search', 'Search tools')}
              style={{ borderRadius: 20 }}
            />
          }>
          {t('agent.settings.toolsMcp.tools.title', 'Pre-approved Tools')}
        </SettingsTitle>
        <div className="mt-2 flex flex-col gap-3">
          {filteredTools.length === 0 ? (
            <div className="rounded-medium border border-default-200 border-dashed px-4 py-10 text-center text-foreground-500 text-sm">
              {t('agent.settings.tooling.preapproved.empty', 'No tools match your filters.')}
            </div>
          ) : (
            filteredTools.map((tool) => {
              const isAuto = autoToolIds.includes(tool.id)
              const isApproved = approvedToolIds.includes(tool.id)
              const toolDescription = tool.type === 'builtin' ? getBuiltinToolDescription(tool.id) : tool.description
              return (
                <Card
                  key={tool.id}
                  className="border border-default-200"
                  title={
                    <div className="flex items-start justify-between gap-3 py-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-medium text-sm">{tool.name}</span>
                        {toolDescription ? (
                          <span className="line-clamp-2 whitespace-normal text-foreground-500 text-xs">
                            {toolDescription}
                          </span>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          {isAuto ? (
                            <Tag color="success">
                              {t('agent.settings.tooling.preapproved.autoBadge', 'Added by mode')}
                            </Tag>
                          ) : null}
                          {tool.type === 'mcp' ? (
                            <Tag color="default">{t('agent.settings.tooling.preapproved.mcpBadge', 'MCP tool')}</Tag>
                          ) : null}
                          {tool.requirePermissions ? (
                            <Tag color="warning">
                              {t(
                                'agent.settings.tooling.preapproved.requiresApproval',
                                'Requires approval when disabled'
                              )}
                            </Tag>
                          ) : null}
                        </div>
                      </div>
                      <Tooltip
                        title={
                          isAuto
                            ? t('agent.settings.tooling.preapproved.autoDisabledTooltip', {
                                mode: selectedModeCard
                                  ? t(selectedModeCard.titleKey, selectedModeCard.titleFallback)
                                  : selectedMode
                              })
                            : undefined
                        }
                        open={isAuto ? undefined : false}>
                        <Switch
                          aria-label={t('agent.settings.tooling.preapproved.toggle', {
                            defaultValue: `Toggle ${tool.name}`,
                            name: tool.name
                          })}
                          checked={isApproved}
                          disabled={isAuto || isUpdatingTools}
                          size="small"
                          onChange={(checked) => handleToggleTool(tool.id, checked)}
                        />
                      </Tooltip>
                    </div>
                  }
                  styles={cardStyles}
                />
              )
            })
          )}
        </div>
      </SettingsItem>

      <SettingsItem divider={false} className="mt-4">
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

export default ToolsSettings
