import { Bot, ChevronDown, CircleSlash, Folder } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { AgentSelector, WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

interface SelectionAgentPickerProps {
  value: string | null
  onChange: (agentId: string | null) => void
  invalid?: boolean
}

export const SelectionAgentPicker: FC<SelectionAgentPickerProps> = ({ value, onChange, invalid }) => {
  const { t } = useTranslation()
  const { agents } = useAgents()
  const agent = agents.find((candidate) => candidate.id === value)

  return (
    <AgentSelector
      value={value}
      onChange={onChange}
      align="start"
      mountStrategy="lazy-keep"
      trigger={
        <Button type="button" variant="outline" className="w-full justify-start" aria-invalid={invalid || undefined}>
          {agent ? <span aria-hidden="true">{getAgentAvatarFromConfiguration(agent.configuration)}</span> : <Bot />}
          <span className="min-w-0 flex-1 truncate text-left">
            {agent?.name ?? t('selection.settings.user_modal.agent.hint')}
          </span>
          <ChevronDown />
        </Button>
      }
    />
  )
}

interface SelectionWorkspacePickerProps {
  value: AgentSessionWorkspaceSource
  onChange: (workspace: AgentSessionWorkspaceSource) => void
}

export const SelectionWorkspacePicker: FC<SelectionWorkspacePickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation()
  const { data: workspaces, refetch } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetch())
  const workspaceId = value.type === AGENT_WORKSPACE_TYPE.USER ? value.workspaceId : null
  const label =
    workspaceId === null
      ? t('agent.session.workspace_selector.no_project')
      : (workspaces?.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId)

  return (
    <WorkspaceSelector
      value={workspaceId}
      onChange={(nextId) =>
        onChange(
          nextId === null
            ? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
            : { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: nextId }
        )
      }
      align="start"
      trigger={
        <Button type="button" variant="outline" className="w-full justify-start">
          {workspaceId === null ? <CircleSlash /> : <Folder />}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown />
        </Button>
      }
    />
  )
}
