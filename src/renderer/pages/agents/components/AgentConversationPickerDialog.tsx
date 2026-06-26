import { loggerService } from '@logger'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ConversationPickerDialog, type ConversationPickerItem } from '@renderer/components/resource'
import {
  ResourceCreateDialog,
  type ResourceCreateDialogValues
} from '@renderer/components/resource/dialogs/ResourceCreateDialog'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AgentConversationPickerDialog')

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
  const modelFilter = useAgentModelFilter('claude-code')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const { trigger: createAgent, isLoading: isCreatingAgent } = useMutation('POST', '/agents', {
    refresh: ['/agents']
  })

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

  // "New agent" closes the picker and hands off to the shared create dialog.
  const handleCreateNew = useCallback(() => {
    onOpenChange(false)
    setCreateDialogOpen(true)
  }, [onOpenChange])

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateDialogValues) => {
      try {
        const created = await createAgent({
          body: {
            type: 'claude-code',
            name: values.name,
            model: values.modelId,
            planModel: values.modelId,
            smallModel: values.modelId,
            description: values.description,
            configuration: {
              avatar: values.avatar,
              permission_mode: 'bypassPermissions',
              soul_enabled: true
            }
          }
        })
        setCreateDialogOpen(false)
        // Start a session with the new agent so it surfaces in the rail (a fresh agent has no session
        // yet), mirroring picking an existing one.
        await onSelect(created.id)
      } catch (error) {
        logger.error('Failed to create agent from conversation picker', error as Error)
        throw error
      }
    },
    [createAgent, onSelect]
  )

  return (
    <>
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
        createAction={{ label: t('selector.agent.create_new'), icon: <Plus />, onSelect: handleCreateNew }}
        isLoading={agentsLoading}
        showCloseButton={false}
        onSelect={handleSelect}
      />
      <ResourceCreateDialog
        kind="agent"
        open={createDialogOpen}
        isSubmitting={isCreatingAgent}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleSubmitCreate}
        modelFilter={modelFilter}
      />
    </>
  )
}
