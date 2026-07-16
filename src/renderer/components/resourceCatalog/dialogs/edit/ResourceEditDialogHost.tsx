import { loggerService } from '@logger'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAssistantApiById } from '@renderer/hooks/useAssistant'
import { toast } from '@renderer/services/toast'
import { isSelectableAssistantModel } from '@renderer/utils/resourceCatalog'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentEditDialog } from './AgentEditDialog'
import { AssistantEditDialog } from './AssistantEditDialog'

export type ResourceEditDialogTarget = { kind: 'assistant'; id: string } | { kind: 'agent'; id: string }

type ResourceEditDialogHostProps = {
  target: ResourceEditDialogTarget | null
  open?: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (target: ResourceEditDialogTarget) => Promise<unknown> | void
}

const logger = loggerService.withContext('ResourceEditDialogHost')

export function ResourceEditDialogHost({ target, open = true, onOpenChange, onSaved }: ResourceEditDialogHostProps) {
  if (target?.kind === 'assistant') {
    return <AssistantEditDialogHost target={target} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
  }

  if (target?.kind === 'agent') {
    return <AgentEditDialogHost target={target} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
  }

  return null
}

function AssistantEditDialogHost({
  target,
  open = true,
  onOpenChange,
  onSaved
}: ResourceEditDialogHostProps & { target: Extract<ResourceEditDialogTarget, { kind: 'assistant' }> }) {
  const { t } = useTranslation()
  const { assistant, error, refetch } = useAssistantApiById(target.id)

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load assistant for edit dialog', error, { id: target.id })
    toast.error(t('common.error'))
    onOpenChange(false)
  }, [error, onOpenChange, t, target.id])

  const handleSaved = useCallback(async () => {
    try {
      await refetch()
      await onSaved?.(target)
    } catch (error) {
      logger.warn('Failed to refresh assistant after edit dialog save', { error, id: target.id })
      toast.error(t('selector.edit_dialog.refresh_failed'))
    }
  }, [onSaved, refetch, t, target])

  return (
    <AssistantEditDialog
      open={open}
      resource={assistant ?? null}
      onOpenChange={onOpenChange}
      onSaved={handleSaved}
      modelFilter={isSelectableAssistantModel}
    />
  )
}

function AgentEditDialogHost({
  target,
  open = true,
  onOpenChange,
  onSaved
}: ResourceEditDialogHostProps & { target: Extract<ResourceEditDialogTarget, { kind: 'agent' }> }) {
  const { t } = useTranslation()
  const modelFilter = useAgentModelFilter('claude-code')
  const { agent, error, revalidate } = useAgent(target.id)

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load agent for edit dialog', error, { id: target.id })
    toast.error(t('common.error'))
    onOpenChange(false)
  }, [error, onOpenChange, t, target.id])

  const handleSaved = useCallback(async () => {
    try {
      await revalidate()
      await onSaved?.(target)
    } catch (error) {
      logger.warn('Failed to refresh agent after edit dialog save', { error, id: target.id })
      toast.error(t('selector.edit_dialog.refresh_failed'))
    }
  }, [onSaved, revalidate, t, target])

  return (
    <AgentEditDialog
      open={open}
      resource={agent ?? null}
      onOpenChange={onOpenChange}
      onSaved={handleSaved}
      modelFilter={modelFilter}
    />
  )
}
