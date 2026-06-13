import { loggerService } from '@logger'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { useAssistantApiById } from '@renderer/hooks/useAssistant'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentEditDialog } from './edit/AgentEditDialog'
import { AssistantEditDialog } from './edit/AssistantEditDialog'
import { isSelectableAssistantModel } from './form/assistantModelFilter'

export type ResourceEditDialogTarget = { kind: 'assistant'; id: string } | { kind: 'agent'; id: string }

type ResourceEditDialogHostProps = {
  target: ResourceEditDialogTarget | null
  onOpenChange: (open: boolean) => void
  onSaved?: (target: ResourceEditDialogTarget) => Promise<unknown> | void
}

const logger = loggerService.withContext('ResourceEditDialogHost')

export function ResourceEditDialogHost({ target, onOpenChange, onSaved }: ResourceEditDialogHostProps) {
  if (target?.kind === 'assistant') {
    return <AssistantEditDialogHost target={target} onOpenChange={onOpenChange} onSaved={onSaved} />
  }

  if (target?.kind === 'agent') {
    return <AgentEditDialogHost target={target} onOpenChange={onOpenChange} onSaved={onSaved} />
  }

  return null
}

function AssistantEditDialogHost({
  target,
  onOpenChange,
  onSaved
}: ResourceEditDialogHostProps & { target: Extract<ResourceEditDialogTarget, { kind: 'assistant' }> }) {
  const { t } = useTranslation()
  const { assistant, error, refetch } = useAssistantApiById(target.id)

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load assistant for edit dialog', error, { id: target.id })
    window.toast?.error(t('common.error'))
  }, [error, t, target.id])

  const handleSaved = useCallback(async () => {
    try {
      await refetch()
      await onSaved?.(target)
    } catch (error) {
      logger.warn('Failed to refresh assistant after edit dialog save', { error, id: target.id })
      window.toast?.error(t('selector.edit_dialog.refresh_failed'))
    }
  }, [onSaved, refetch, t, target])

  return (
    <AssistantEditDialog
      open
      resource={assistant ?? null}
      onOpenChange={onOpenChange}
      onSaved={handleSaved}
      modelFilter={isSelectableAssistantModel}
    />
  )
}

function AgentEditDialogHost({
  target,
  onOpenChange,
  onSaved
}: ResourceEditDialogHostProps & { target: Extract<ResourceEditDialogTarget, { kind: 'agent' }> }) {
  const { t } = useTranslation()
  const modelFilter = useAgentModelFilter('claude-code')
  const { agent, error, revalidate } = useAgent(target.id)

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load agent for edit dialog', error, { id: target.id })
    window.toast?.error(t('common.error'))
  }, [error, t, target.id])

  const handleSaved = useCallback(async () => {
    try {
      await revalidate()
      await onSaved?.(target)
    } catch (error) {
      logger.warn('Failed to refresh agent after edit dialog save', { error, id: target.id })
      window.toast?.error(t('selector.edit_dialog.refresh_failed'))
    }
  }, [onSaved, revalidate, t, target])

  return (
    <AgentEditDialog
      open
      resource={agent ?? null}
      onOpenChange={onOpenChange}
      onSaved={handleSaved}
      modelFilter={modelFilter}
    />
  )
}
