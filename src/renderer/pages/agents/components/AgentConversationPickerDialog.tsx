import EmojiIcon from '@renderer/components/EmojiIcon'
import { ConversationPickerDialog, type ConversationPickerItem } from '@renderer/components/resource'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type AgentConversationPickerItem = ConversationPickerItem & {
  agentId: string
}

type AgentConversationPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: readonly AgentEntity[]
  agentsLoading?: boolean
  onSelect: (agentId: string) => void | Promise<void>
}

export function AgentConversationPickerDialog({
  open,
  onOpenChange,
  agents,
  agentsLoading = false,
  onSelect
}: AgentConversationPickerDialogProps) {
  const { t } = useTranslation()

  const items = useMemo<AgentConversationPickerItem[]>(
    () =>
      agents.map((agent) => ({
        id: `agent:${agent.id}`,
        name: agent.name,
        searchText: agent.description,
        icon: (
          <EmojiIcon
            emoji={getAgentAvatarFromConfiguration(agent.configuration)}
            size={24}
            fontSize={14}
            className="mr-0"
          />
        ),
        agentId: agent.id
      })),
    [agents]
  )

  // The picker closes itself before the caller runs its async work (avoids a refetch flash while the
  // dialog is still mounted), so this just maps the row to its agent id.
  const handleSelect = useCallback((item: AgentConversationPickerItem) => onSelect(item.agentId), [onSelect])

  return (
    <ConversationPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      labels={{
        title: t('agent.add.title'),
        description: t('agent.add.description'),
        searchPlaceholder: t('selector.agent.search_placeholder'),
        emptyText: t('selector.agent.empty_text'),
        loadingText: t('common.loading')
      }}
      isLoading={agentsLoading}
      onSelect={handleSelect}
    />
  )
}
