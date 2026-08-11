import { loggerService } from '@logger'
import {
  ResourceCreateWizard,
  type ResourceCreateWizardValues
} from '@renderer/components/resourceCatalog/dialogs/create'
import { useAgentMutations } from '@renderer/hooks/resourceCatalog'
import { buildCreateAgentCommand } from '@renderer/utils/resourceCatalog'
import { useCallback } from 'react'

const logger = loggerService.withContext('AgentCreateDialog')

type AgentCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void | Promise<void>
}

export function AgentCreateDialog({ open, onOpenChange, onCreated }: AgentCreateDialogProps) {
  const { createAgent, isCreatingAgent } = useAgentMutations()

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      try {
        const created = await createAgent(buildCreateAgentCommand(values))
        onOpenChange(false)
        await onCreated(created.id)
      } catch (error) {
        logger.error('Failed to create agent', error as Error)
        throw error
      }
    },
    [createAgent, onCreated, onOpenChange]
  )

  return (
    <ResourceCreateWizard
      kind="agent"
      open={open}
      isSubmitting={isCreatingAgent}
      onOpenChange={onOpenChange}
      onSubmit={handleSubmitCreate}
    />
  )
}
