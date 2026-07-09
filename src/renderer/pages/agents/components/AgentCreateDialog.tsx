import { loggerService } from '@logger'
import {
  ResourceCreateWizard,
  type ResourceCreateWizardValues
} from '@renderer/components/resourceCatalog/dialogs/create'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useCallback } from 'react'

const logger = loggerService.withContext('AgentCreateDialog')

type AgentCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void | Promise<void>
}

export function AgentCreateDialog({ open, onOpenChange, onCreated }: AgentCreateDialogProps) {
  const modelFilter = useAgentModelFilter('claude-code')
  const { trigger: createAgent, isLoading: isCreatingAgent } = useMutation('POST', '/agents', {
    refresh: ['/agents']
  })

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      try {
        const created = await createAgent({
          body: {
            type: 'claude-code',
            name: values.name,
            model: values.modelId,
            planModel: values.modelId,
            smallModel: values.modelId,
            description: values.description,
            instructions: values.prompt,
            skillIds: values.skillIds,
            configuration: {
              avatar: values.avatar,
              permission_mode: 'bypassPermissions',
              soul_enabled: true
            }
          }
        })
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
      modelFilter={modelFilter}
    />
  )
}
