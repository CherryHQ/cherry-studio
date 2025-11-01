import { Alert, Card, CardBody, CardHeader, Chip, Input, Switch } from '@heroui/react'
import { permissionModeCards } from '@renderer/config/agent'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import type {
  AgentConfiguration,
  GetAgentResponse,
  GetAgentSessionResponse,
  PermissionMode,
  Tool,
  UpdateAgentBaseForm,
  UpdateAgentFunction,
  UpdateAgentSessionFunction
} from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import { Modal } from 'antd'
import { ShieldAlert, ShieldCheck, Wrench } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

type AgentToolingSettingsProps =
  | {
      agentBase: GetAgentResponse | undefined | null
      update: UpdateAgentFunction
    }
  | {
      agentBase: GetAgentSessionResponse | undefined | null
      update: UpdateAgentSessionFunction
    }

type AgentConfigurationState = AgentConfiguration & Record<string, unknown>

const defaultConfiguration: AgentConfigurationState = AgentConfigurationSchema.parse({})

/**
 * Computes the list of tool IDs that should be automatically approved for a given permission mode.
 *
 * @param mode - The permission mode to compute defaults for.
 * @param tools - The full list of available tools.
 * @returns An array of tool IDs that are approved by default for the specified mode.
 */
const computeModeDefaults = (mode: PermissionMode, tools: Tool[]): string[] => {
  const defaultToolIds = tools.filter((tool) => !tool.requirePermissions).map((tool) => tool.id)
  switch (mode) {
    case 'acceptEdits':
      return [
        ...defaultToolIds,
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'Write',
        'Bash(mkdir:*)',
        'Bash(touch:*)',
        'Bash(rm:*)',
        'Bash(mv:*)',
        'Bash(cp:*)'
      ]
    case 'bypassPermissions':
      return tools.map((tool) => tool.id)
    case 'default':
    case 'plan':
      return defaultToolIds
  }
}

const unique = (values: string[]) => Array.from(new Set(values))

export const ToolingSettings: FC<AgentToolingSettingsProps> = ({ agentBase, update }) => {
  const { containerRef, handleScroll } = useScrollPosition('AgentToolingSettings', 100)
  const { t } = useTranslation()
  const { mcpServers: allServers } = useMCPServers()
  const [modal, contextHolder] = Modal.useModal()

  const configuration: AgentConfigurationState = useMemo(
    () => agentBase?.configuration ?? defaultConfiguration,
    [agentBase?.configuration]
  )
  const selectedMode = useMemo(
    () => agentBase?.configuration?.permission_mode ?? defaultConfiguration.permission_mode,
    [agentBase?.configuration?.permission_mode]
  )
  const availableTools = useMemo(() => agentBase?.tools ?? [], [agentBase?.tools])
  const autoToolIds = useMemo(() => computeModeDefaults(selectedMode, availableTools), [availableTools, selectedMode])
  const approvedToolIds = useMemo(() => {
    const allowed = agentBase?.allowed_tools ?? []
    const sanitized = allowed.filter((id) => availableTools.some((tool) => tool.id === id))
    // Ensure defaults are included even if backend omitted them
    const merged = unique([...sanitized, ...autoToolIds])
    return merged
  }, [agentBase?.allowed_tools, autoToolIds, availableTools])
  const selectedMcpIds = useMemo(() => agentBase?.mcps ?? [], [agentBase?.mcps])
  const [searchTerm, setSearchTerm] = useState('')
  const [isUpdatingMode, setIsUpdatingMode] = useState(false)
  const [isUpdatingTools, setIsUpdatingTools] = useState(false)
  const [isUpdatingMcp, setIsUpdatingMcp] = useState(false)

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

  const userAddedIds = useMemo(() => {
    return approvedToolIds.filter((id) => !autoToolIds.includes(id))
  }, [approvedToolIds, autoToolIds])

  const handleSelectPermissionMode = useCallback(
    (nextMode: PermissionMode) => {
      if (!agentBase || nextMode === selectedMode || isUpdatingMode) {
        return
      }
      const defaults = computeModeDefaults(nextMode, availableTools)
      const merged = unique([...defaults, ...userAddedIds])
      const removedDefaults = autoToolIds.filter((id) => !defaults.includes(id))

      const applyChange = async () => {
        setIsUpdatingMode(true)
        try {
          const nextConfiguration = { ...configuration, permission_mode: nextMode } satisfies AgentConfigurationState
          await update({
            id: agentBase.id,
            configuration: nextConfiguration,
            allowed_tools: merged
          } satisfies UpdateAgentBaseForm)
        } finally {
          setIsUpdatingMode(false)
        }
      }

      if (removedDefaults.length > 0) {
        modal.confirm({
          title: (
            <span className="text-foreground">
              {t('agent.settings.tooling.permissionMode.confirmChange.title', 'Change permission mode?')}
            </span>
          ),
          content: (
            <div className="flex flex-col gap-2">
              <p className="text-foreground-500 text-sm">
                {t(
                  'agent.settings.tooling.permissionMode.confirmChange.description',
                  'Switching modes updates the automatically approved tools.'
                )}
              </p>
              <div className="rounded-medium border border-default-200 bg-default-50 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{t('common.removed', 'Removed')}:</span>
                <ul className="mt-1 list-disc pl-4">
                  {removedDefaults.map((id) => {
                    const tool = availableTools.find((item) => item.id === id)
                    return (
                      <li className="text-foreground" key={id}>
                        {tool?.name ?? id}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          ),
          centered: true,
          okText: t('common.confirm'),
          cancelText: t('common.cancel'),
          onOk: applyChange,
          classNames: {
            content: 'bg-background! border! border-solid! rounded border-grey border-default-200!'
          }
        })
      } else {
        void applyChange()
      }
    },
    [
      agentBase,
      selectedMode,
      isUpdatingMode,
      availableTools,
      userAddedIds,
      autoToolIds,
      configuration,
      update,
      modal,
      t
    ]
  )

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
      const sanitized = unique(next.filter((id) => availableTools.some((tool) => tool.id === id)).concat(autoToolIds))
      try {
        await update({ id: agentBase.id, allowed_tools: sanitized } satisfies UpdateAgentBaseForm)
      } finally {
        setIsUpdatingTools(false)
      }
    },
    [agentBase, isUpdatingTools, approvedToolIds, autoToolIds, availableTools, update]
  )

  const { agentSummary, autoCount, customCount } = useMemo(() => {
    const autoCountValue = autoToolIds.length
    const customCountValue = userAddedIds.length
    return {
      agentSummary: {
        mode: selectedMode,
        auto: autoCountValue,
        custom: customCountValue,
        totalTools: availableTools.length,
        mcps: selectedMcpIds.length
      },
      autoCount: autoCountValue,
      customCount: customCountValue
    }
  }, [selectedMode, autoToolIds, userAddedIds, availableTools.length, selectedMcpIds.length])

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
    <SettingsContainer ref={containerRef} onScroll={handleScroll}>
      {contextHolder}
      <SettingsItem>
        <SettingsTitle>
          {t('agent.settings.tooling.steps.permissionMode.title', 'Step 1 · Permission mode')}
        </SettingsTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {permissionModeCards.map((card) => {
            const isSelected = card.mode === selectedMode
            const disabled = card.unsupported
            const showCaution = card.caution

            return (
              <Card
                key={card.mode}
                isPressable={!disabled}
                isDisabled={disabled || isUpdatingMode}
                shadow="none"
                onPress={() => handleSelectPermissionMode(card.mode)}
                className={`border ${
                  isSelected ? 'border-primary' : 'border-default-200'
                } ${disabled ? 'opacity-60' : ''}`}>
                <CardHeader className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-left font-semibold text-sm">{t(card.titleKey, card.titleFallback)}</span>
                    <span className="text-left text-foreground-500 text-xs">
                      {t(card.descriptionKey, card.descriptionFallback)}
                    </span>
                  </div>
                  {disabled ? (
                    <Chip color="warning" size="sm" variant="flat">
                      {t('common.coming_soon', 'Coming soon')}
                    </Chip>
                  ) : isSelected ? (
                    <Chip color="primary" size="sm" variant="flat" startContent={<ShieldCheck size={14} />}>
                      {t('common.selected', 'Selected')}
                    </Chip>
                  ) : null}
                </CardHeader>
                <CardBody className="gap-2 text-left text-xs">
                  <span className="text-foreground-600">{t(card.behaviorKey, card.behaviorFallback)}</span>
                  {showCaution ? (
                    <div className="flex items-center gap-1">
                      <ShieldAlert className="text-danger-600" size={24} />
                      <span className="text-danger-600">
                        {t(
                          'agent.settings.tooling.permissionMode.bypassPermissions.warning',
                          'Use with caution — all tools will run without asking for approval.'
                        )}
                      </span>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            )
          })}
        </div>
      </SettingsItem>

      <SettingsItem>
        <SettingsTitle>
          {t('agent.settings.tooling.steps.preapproved.title', 'Step 2 · Pre-approved tools')}
        </SettingsTitle>
        <div className="flex flex-col gap-4">
          <Alert
            color="warning"
            title={t(
              'agent.settings.tooling.preapproved.warning.title',
              'Pre-approved tools run without manual review.'
            )}
            description={t(
              'agent.settings.tooling.preapproved.warning.description',
              'Enable only tools you trust. Mode defaults are highlighted automatically.'
            )}
          />
          <Input
            isClearable
            value={searchTerm}
            onValueChange={setSearchTerm}
            placeholder={t('agent.settings.tooling.preapproved.search', 'Search tools')}
            aria-label={t('agent.settings.tooling.preapproved.search', 'Search tools')}
            className="w-full"
          />
          <div className="flex flex-col gap-3">
            {filteredTools.length === 0 ? (
              <div className="rounded-medium border border-default-200 border-dashed px-4 py-10 text-center text-foreground-500 text-sm">
                {t('agent.settings.tooling.preapproved.empty', 'No tools match your filters.')}
              </div>
            ) : (
              filteredTools.map((tool) => {
                const isAuto = autoToolIds.includes(tool.id)
                const isApproved = approvedToolIds.includes(tool.id)
                return (
                  <Card key={tool.id} shadow="none" className="border border-default-200">
                    <CardHeader className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-medium text-sm">{tool.name}</span>
                        {tool.description ? (
                          <span className="line-clamp-2 text-foreground-500 text-xs">{tool.description}</span>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          {isAuto ? (
                            <Chip size="sm" color="primary" variant="flat">
                              {t('agent.settings.tooling.preapproved.autoBadge', 'Added by mode')}
                            </Chip>
                          ) : null}
                          {tool.type === 'mcp' ? (
                            <Chip size="sm" color="secondary" variant="flat">
                              {t('agent.settings.tooling.preapproved.mcpBadge', 'MCP tool')}
                            </Chip>
                          ) : null}
                          {tool.requirePermissions ? (
                            <Chip size="sm" color="warning" variant="flat">
                              {t(
                                'agent.settings.tooling.preapproved.requiresApproval',
                                'Requires approval when disabled'
                              )}
                            </Chip>
                          ) : null}
                        </div>
                      </div>
                      <Switch
                        aria-label={t('agent.settings.tooling.preapproved.toggle', {
                          defaultValue: `Toggle ${tool.name}`,
                          name: tool.name
                        })}
                        isSelected={isApproved}
                        isDisabled={isAuto || isUpdatingTools}
                        size="sm"
                        onValueChange={(value) => handleToggleTool(tool.id, value)}
                      />
                    </CardHeader>
                    {isAuto ? (
                      <CardBody className="py-0 pb-3">
                        <span className="text-foreground-400 text-xs">
                          {t(
                            'agent.settings.tooling.preapproved.autoDescription',
                            'This tool is auto-approved by the current permission mode.'
                          )}
                        </span>
                      </CardBody>
                    ) : null}
                  </Card>
                )
              })
            )}
          </div>
        </div>
      </SettingsItem>

      <SettingsItem>
        <SettingsTitle>{t('agent.settings.tooling.steps.mcp.title', 'MCP servers')}</SettingsTitle>
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
                  <Card key={server.id} shadow="none" className="border border-default-200">
                    <CardHeader className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-sm">{server.name}</span>
                        {server.description ? (
                          <span className="line-clamp-2 text-foreground-500 text-xs">{server.description}</span>
                        ) : null}
                      </div>
                      <Switch
                        aria-label={t('agent.settings.tooling.mcp.toggle', {
                          defaultValue: `Toggle ${server.name}`,
                          name: server.name
                        })}
                        isSelected={isSelected}
                        size="sm"
                        isDisabled={!server.isActive || isUpdatingMcp}
                        onValueChange={(value) => handleToggleMcp(server.id, value)}
                      />
                    </CardHeader>
                  </Card>
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

      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.settings.tooling.steps.review.title', 'Step 3 · Review')}</SettingsTitle>
        <Card shadow="none" className="border border-default-200">
          <CardBody className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap gap-3">
              <Chip variant="flat" color="primary">
                {t('agent.settings.tooling.review.mode', {
                  defaultValue: `Mode: ${selectedMode}`,
                  mode: selectedMode
                })}
              </Chip>
              <Chip variant="flat" color="default">
                {t('agent.settings.tooling.review.autoTools', {
                  defaultValue: `Auto: ${autoCount}`,
                  count: autoCount
                })}
              </Chip>
              <Chip variant="flat" color="success">
                {t('agent.settings.tooling.review.customTools', {
                  defaultValue: `Custom: ${customCount}`,
                  count: customCount
                })}
              </Chip>
              <Chip variant="flat" color="warning">
                {t('agent.settings.tooling.review.mcp', {
                  defaultValue: `MCP: ${agentSummary.mcps}`,
                  count: agentSummary.mcps
                })}
              </Chip>
            </div>
            <span className="text-foreground-500 text-xs">
              {t(
                'agent.settings.tooling.review.helper',
                'Changes save automatically. Adjust the steps above any time to fine-tune permissions.'
              )}
            </span>
          </CardBody>
        </Card>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default ToolingSettings
