import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { loggerService } from '@logger'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentModelDisabled, useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAssistantApiById } from '@renderer/hooks/useAssistant'
import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import { toast } from '@renderer/services/toast'
import type { ResourceEditDialogTarget } from '@renderer/types/resourceCatalog'
import { CHERRY_CLOUD_MODEL_FEATURE } from '@shared/data/presets/cherryai'
import { isNonChatModel } from '@shared/utils/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentEditDialog } from './AgentEditDialog'
import { AssistantEditDialog } from './AssistantEditDialog'

type ResourceEditDialogHostProps = {
  target: ResourceEditDialogTarget | null
  onOpenChange: (open: boolean) => void
}

const logger = loggerService.withContext('ResourceEditDialogHost')
export function ResourceEditDialogHost({ target, onOpenChange }: ResourceEditDialogHostProps) {
  const [open, setOpen] = useState(target !== null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return

    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  // A fresh target object represents a distinct open request, even when its fields match.
  useEffect(() => {
    clearCloseTimer()
    setOpen(target !== null)
  }, [clearCloseTimer, target])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      clearCloseTimer()
      setOpen(nextOpen)

      if (nextOpen) {
        onOpenChange(true)
        return
      }

      // Keep the target mounted until the shared close delay expires.
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        onOpenChange(false)
      }, DIALOG_UNMOUNT_DELAY_MS)
    },
    [clearCloseTimer, onOpenChange]
  )

  if (target?.kind === 'assistant') {
    return <AssistantEditDialogHost target={target} open={open} onOpenChange={handleOpenChange} />
  }

  if (target?.kind === 'agent') {
    return <AgentEditDialogHost target={target} open={open} onOpenChange={handleOpenChange} />
  }

  return null
}

function AssistantEditDialogHost({
  target,
  open,
  onOpenChange
}: ResourceEditDialogHostProps & {
  target: Extract<ResourceEditDialogTarget, { kind: 'assistant' }>
  open: boolean
}) {
  const { t } = useTranslation()
  const { assistant, error } = useAssistantApiById(target.id)
  const { isModelAvailableForFeature, isModelDisabled } = useCherryCloudModelAvailability(open)
  const assistantModelFilter = useCallback<ModelSelectorFilter>(
    (model) => isModelAvailableForFeature(model, CHERRY_CLOUD_MODEL_FEATURE.CHAT) && !isNonChatModel(model),
    [isModelAvailableForFeature]
  )

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load assistant for edit dialog', error, { id: target.id })
    toast.error(t('common.error'))
  }, [error, t, target.id])

  return (
    <AssistantEditDialog
      open={open}
      resource={assistant ?? null}
      onOpenChange={onOpenChange}
      modelFilter={assistantModelFilter}
      isModelDisabled={isModelDisabled}
      initialTab={target.initialTab}
    />
  )
}

function AgentEditDialogHost({
  target,
  open,
  onOpenChange
}: ResourceEditDialogHostProps & {
  target: Extract<ResourceEditDialogTarget, { kind: 'agent' }>
  open: boolean
}) {
  const { t } = useTranslation()
  const { agent, error } = useAgent(target.id)
  const modelFilter = useAgentModelFilter(agent?.type, open)
  const isModelDisabled = useAgentModelDisabled(open)

  useEffect(() => {
    if (!error) return

    logger.error('Failed to load agent for edit dialog', error, { id: target.id })
    toast.error(t('common.error'))
  }, [error, t, target.id])

  return (
    <AgentEditDialog
      open={open}
      resource={agent ?? null}
      onOpenChange={onOpenChange}
      modelFilter={modelFilter}
      isModelDisabled={isModelDisabled}
      initialTab={target.initialTab}
    />
  )
}
