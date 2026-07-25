import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { loggerService } from '@logger'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAssistantApiById } from '@renderer/hooks/useAssistant'
import { toast } from '@renderer/services/toast'
import { isSelectableAssistantModel } from '@renderer/utils/resourceCatalog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentEditDialog } from './AgentEditDialog'
import { AssistantEditDialog } from './AssistantEditDialog'

export type ResourceEditDialogTarget = ({ kind: 'assistant'; id: string } | { kind: 'agent'; id: string }) & {
  /** Leaf tab id to open the dialog on (e.g. `tools.mcp`, `tools.skills`). */
  initialTab?: string
}

type ResourceEditDialogHostProps = {
  target: ResourceEditDialogTarget | null
  onOpenChange: (open: boolean) => void
  onSaved?: (target: ResourceEditDialogTarget) => Promise<unknown> | void
}

const logger = loggerService.withContext('ResourceEditDialogHost')

export function ResourceEditDialogHost({ target, onOpenChange, onSaved }: ResourceEditDialogHostProps) {
  const [open, setOpen] = useState(target !== null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetKey = target ? `${target.kind}:${target.id}:${target.initialTab ?? ''}` : null
  const hasTarget = target !== null

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return

    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  useEffect(() => {
    clearCloseTimer()
    setOpen(hasTarget)
  }, [clearCloseTimer, hasTarget, targetKey])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      clearCloseTimer()
      setOpen(nextOpen)

      if (nextOpen) {
        onOpenChange(true)
        return
      }

      // Keep the target mounted through the close animation and its final paint frame.
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        onOpenChange(false)
      }, DIALOG_UNMOUNT_DELAY_MS)
    },
    [clearCloseTimer, onOpenChange]
  )

  if (target?.kind === 'assistant') {
    return <AssistantEditDialogHost target={target} open={open} onOpenChange={handleOpenChange} onSaved={onSaved} />
  }

  if (target?.kind === 'agent') {
    return <AgentEditDialogHost target={target} open={open} onOpenChange={handleOpenChange} onSaved={onSaved} />
  }

  return null
}

function AssistantEditDialogHost({
  target,
  open,
  onOpenChange,
  onSaved
}: ResourceEditDialogHostProps & {
  target: Extract<ResourceEditDialogTarget, { kind: 'assistant' }>
  open: boolean
}) {
  const { t } = useTranslation()
  const { assistant, error, refetch } = useAssistantApiById(target.id)

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load assistant for edit dialog', error, { id: target.id })
    toast.error(t('common.error'))
  }, [error, t, target.id])

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
      initialTab={target.initialTab}
    />
  )
}

function AgentEditDialogHost({
  target,
  open,
  onOpenChange,
  onSaved
}: ResourceEditDialogHostProps & {
  target: Extract<ResourceEditDialogTarget, { kind: 'agent' }>
  open: boolean
}) {
  const { t } = useTranslation()
  const modelFilter = useAgentModelFilter('claude-code')
  const { agent, error, revalidate } = useAgent(target.id)

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load agent for edit dialog', error, { id: target.id })
    toast.error(t('common.error'))
  }, [error, t, target.id])

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
      initialTab={target.initialTab}
    />
  )
}
