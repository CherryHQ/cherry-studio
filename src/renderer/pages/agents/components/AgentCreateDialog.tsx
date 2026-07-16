import { loggerService } from '@logger'
import {
  ResourceCreateWizard,
  type ResourceCreateWizardValues
} from '@renderer/components/resourceCatalog/dialogs/create'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { buildCreateAgentDto } from '@renderer/utils/resourceCatalog'
import { useCallback } from 'react'

const logger = loggerService.withContext('AgentCreateDialog')

type AgentCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void | Promise<void>
}

export function AgentCreateDialog({ open, onOpenChange, onCreated }: AgentCreateDialogProps) {
  const { trigger: createAgent, isLoading: isCreatingAgent } = useMutation('POST', '/agents', {
    refresh: ['/agents']
  })

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      try {
        const created = await createAgent({ body: buildCreateAgentDto(values, values.agentType) })
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
