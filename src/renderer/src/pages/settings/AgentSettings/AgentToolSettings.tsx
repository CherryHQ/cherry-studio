import { Alert, Card, CardBody, CardHeader, Switch, Tooltip } from '@heroui/react'
import { GetAgentResponse, Tool, UpdateAgentForm } from '@renderer/types'
import { Info } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

interface AgentToolSettingsProps {
  agent: GetAgentResponse | undefined | null
  updateAgent: (form: UpdateAgentForm) => Promise<void> | void
}

const isSameSelection = (next: string[], previous: string[]) => {
  if (next.length !== previous.length) {
    return false
  }
  const previousSet = new Set(previous)
  return next.every((id) => previousSet.has(id))
}

export const AgentToolSettings: FC<AgentToolSettingsProps> = ({ agent, updateAgent }) => {
  const { t } = useTranslation()
  const [approvedIds, setApprovedIds] = useState<string[]>([])

  const availableTools = useMemo<Tool[]>(() => agent?.tools ?? [], [agent?.tools])

  useEffect(() => {
    if (!agent) {
      setApprovedIds((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const allowed = agent.allowed_tools ?? []
    const validIds = allowed.filter((id) => availableTools.some((tool) => tool.id === id))
    setApprovedIds((prev) => {
      if (isSameSelection(prev, validIds)) {
        return prev
      }
      return validIds
    })
  }, [agent, availableTools])

  const handleToggle = useCallback(
    (toolId: string, isApproved: boolean) => {
      if (!agent) return

      setApprovedIds((prev) => {
        const exists = prev.includes(toolId)
        if (isApproved === exists) {
          return prev
        }
        const next = isApproved ? [...prev, toolId] : prev.filter((id) => id !== toolId)
        const previous = agent.allowed_tools ?? []
        if (!isSameSelection(next, previous)) {
          updateAgent({ id: agent.id, allowed_tools: next })
        }
        return next
      })
    },
    [agent, updateAgent]
  )

  const approvedCount = useMemo(() => {
    return approvedIds.filter((id) => availableTools.some((tool) => tool.id === id)).length
  }, [approvedIds, availableTools])

  if (!agent) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem divider={false} className="flex-1">
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-center justify-between">
            <SettingsTitle>
              {t('agent.settings.tools.title', 'Pre-approved tools')}
              <Tooltip
                placement="right"
                content={t('agent.settings.tools.description', 'Choose which tools can run without manual approval.')}>
                <Info size={16} className="text-foreground-400" />
              </Tooltip>
            </SettingsTitle>
            {availableTools.length > 0 ? (
              <span className="text-foreground-500 text-xs">
                {approvedCount} / {availableTools.length} {t('agent.settings.tools.approved', 'approved')}
              </span>
            ) : null}
          </div>

          <div>
            <Alert
              color="warning"
              title={t(
                'agent.settings.tools.caution',
                'Pre-approved tools bypass human review. Enable only trusted tools.'
              )}
            />
          </div>

          {availableTools.length > 0 ? (
            <div className="flex flex-1 flex-col gap-3 overflow-auto pr-1">
              {availableTools.map((tool) => {
                const isApproved = approvedIds.includes(tool.id)
                return (
                  <Card key={tool.id} shadow="none" className="border border-default-200">
                    <CardHeader className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate font-medium text-sm">{tool.name}</span>
                        {tool.description ? (
                          <span className="line-clamp-2 text-foreground-500 text-xs">{tool.description}</span>
                        ) : null}
                      </div>
                      <Switch
                        aria-label={t('agent.settings.tools.toggle', {
                          defaultValue: `Toggle ${tool.name}`
                        })}
                        isSelected={isApproved}
                        size="sm"
                        onValueChange={(value) => handleToggle(tool.id, value)}
                      />
                    </CardHeader>
                    {tool.requirePermissions ? (
                      <CardBody className="py-0 pb-3">
                        <span className="text-foreground-400 text-xs">
                          {t('agent.settings.tools.requiresPermission', 'Requires permission when not pre-approved.')}
                        </span>
                      </CardBody>
                    ) : null}
                  </Card>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-medium border border-default-200 border-dashed px-4 py-10 text-foreground-500 text-sm">
              {t('agent.session.allowed_tools.empty')}
            </div>
          )}
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentToolSettings
