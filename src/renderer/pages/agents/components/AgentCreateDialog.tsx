import { useCallback, useState } from 'react'

import { loggerService } from '@logger'
import {
  ResourceCreateWizard,
  type ResourceCreateWizardValues
} from '@renderer/components/resourceCatalog/dialogs/create'
import { ResourceEditDialogHost } from '@renderer/components/resourceCatalog/dialogs/edit'
import { useAgentMutations } from '@renderer/hooks/resourceCatalog'
import type { ResourceEditDialogTarget } from '@renderer/types/resourceCatalog'
import { buildCreateAgentCommand } from '@renderer/utils/resourceCatalog'

const logger = loggerService.withContext('AgentCreateDialog')

type AgentCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void | Promise<void>
}

export function AgentCreateDialog({ open, onOpenChange, onCreated }: AgentCreateDialogProps) {
  const { createAgent, isCreatingAgent } = useAgentMutations()
  const [profileTarget, setProfileTarget] = useState<ResourceEditDialogTarget | null>(null)

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      try {
        const created = await createAgent(buildCreateAgentCommand(values))
        onOpenChange(false)
        await onCreated(created.id)
        // Land on the new Agent's profile card, over the conversation it was opened in.
        setProfileTarget({ kind: 'agent', id: created.id, setupIncomplete: values.setupIncomplete })
      } catch (error) {
        logger.error('Failed to create agent', error as Error)
        throw error
      }
    },
    [createAgent, onCreated, onOpenChange]
  )

  return (
    <>
      <ResourceCreateWizard
        kind="agent"
        open={open}
        isSubmitting={isCreatingAgent}
        onOpenChange={onOpenChange}
        onSubmit={handleSubmitCreate}
      />
      <ResourceEditDialogHost
        target={profileTarget}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setProfileTarget(null)
        }}
      />
    </>
  )
}
