import { LoadingIcon } from '@renderer/components/Icons'
import { useModels } from '@renderer/hooks/useModels'
import type { ModelSyncMissingAction } from '@shared/data/api/schemas/providers'
import type { UniqueModelId } from '@shared/data/types/model'
import { Download } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../components/ProviderSettingsDrawer'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import { useProviderModelListSyncFlow } from '../hooks/useProviderModelListSyncFlow'
import ModelSyncPreviewPanel from './ModelSyncPreviewPanel'

interface ModelListSyncDrawerProps {
  open: boolean
  providerId: string
  onClose: () => void
  /** When preview fetch or apply is in progress (for toolbar busy state). */
  onActivityChange?: (active: boolean) => void
}

export default function ModelListSyncDrawer({ open, providerId, onClose, onActivityChange }: ModelListSyncDrawerProps) {
  const { t } = useTranslation()
  const { refetch: refetchModels } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { preview, isLoading, isApplying, fetchPreview, apply, reset } = useProviderModelListSyncFlow(providerId)
  const [selectedAddedIds, setSelectedAddedIds] = useState<Set<UniqueModelId>>(new Set())
  const [selectedMissingActions, setSelectedMissingActions] = useState<Map<UniqueModelId, ModelSyncMissingAction>>(
    new Map()
  )

  useEffect(() => {
    onActivityChange?.(open && (isLoading || isApplying))
  }, [open, isLoading, isApplying, onActivityChange])

  useEffect(() => {
    if (!open) {
      reset()
      setSelectedAddedIds(new Set())
      setSelectedMissingActions(new Map())
      return
    }
    void fetchPreview()
  }, [open, fetchPreview, reset])

  useEffect(() => {
    if (!preview) {
      return
    }
    setSelectedAddedIds(new Set(preview.added.map((m) => m.id)))
    setSelectedMissingActions(
      new Map(preview.missing.map((item) => [item.model.id, item.defaultAction as ModelSyncMissingAction]))
    )
  }, [preview])

  const toggleAddedSelection = useCallback((uniqueModelId: UniqueModelId) => {
    setSelectedAddedIds((current) => {
      const next = new Set(current)
      if (next.has(uniqueModelId)) {
        next.delete(uniqueModelId)
      } else {
        next.add(uniqueModelId)
      }
      return next
    })
  }, [])

  const toggleMissingSelection = useCallback(
    (uniqueModelId: UniqueModelId) => {
      setSelectedMissingActions((current) => {
        const next = new Map(current)
        if (next.has(uniqueModelId)) {
          next.delete(uniqueModelId)
        } else {
          const defaultAction =
            preview?.missing.find((item) => item.model.id === uniqueModelId)?.defaultAction ?? 'deprecated'
          next.set(uniqueModelId, defaultAction as ModelSyncMissingAction)
        }
        return next
      })
    },
    [preview]
  )

  const toggleMissingAction = useCallback((uniqueModelId: UniqueModelId) => {
    setSelectedMissingActions((current) => {
      const next = new Map(current)
      const currentAction = next.get(uniqueModelId)
      if (!currentAction) {
        return current
      }
      next.set(uniqueModelId, currentAction === 'delete' ? 'deprecated' : 'delete')
      return next
    })
  }, [])

  const toggleAllAdded = useCallback(() => {
    if (!preview) {
      return
    }
    setSelectedAddedIds((current) => {
      if (current.size === preview.added.length) {
        return new Set()
      }
      return new Set(preview.added.map((model) => model.id))
    })
  }, [preview])

  const toggleAllMissing = useCallback(() => {
    if (!preview) {
      return
    }
    setSelectedMissingActions((current) => {
      if (current.size === preview.missing.length) {
        return new Map()
      }
      return new Map(preview.missing.map((item) => [item.model.id, item.defaultAction as ModelSyncMissingAction]))
    })
  }, [preview])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const handleApply = useCallback(async () => {
    if (!preview) {
      return
    }

    const addModelIds = preview.added.filter((model) => selectedAddedIds.has(model.id)).map((model) => model.id)
    const missing = preview.missing
      .filter((item) => selectedMissingActions.has(item.model.id))
      .map((item) => ({
        uniqueModelId: item.model.id,
        action: selectedMissingActions.get(item.model.id) ?? ('deprecated' as const)
      }))

    try {
      const result = await apply({ addModelIds, missing })
      await refetchModels()
      window.toast.success(
        t('settings.models.manage.sync_apply_result', {
          added: result.addedCount,
          deprecated: result.deprecatedCount,
          deleted: result.deletedCount
        })
      )
      onClose()
    } catch {
      // toast in apply()
    }
  }, [apply, onClose, preview, refetchModels, selectedAddedIds, selectedMissingActions, t])

  const headerTitle = (
    <div className="flex w-full min-w-0 items-center gap-2">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--cherry-active-bg)]">
        <Download className="size-2.5 text-[var(--cherry-primary)]" aria-hidden />
      </div>
      <span className="truncate font-semibold text-foreground text-sm">
        {t('settings.models.manage.fetch_result_title')}
      </span>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={headerTitle}
      size="fetch"
      bodyClassName="!gap-0 !px-0 !py-0">
      {isLoading || !preview ? (
        <div className="flex min-h-[18rem] flex-1 items-center justify-center">
          <LoadingIcon color="var(--color-muted-foreground)" />
        </div>
      ) : (
        <ModelSyncPreviewPanel
          preview={preview}
          selectedAddedIds={selectedAddedIds}
          selectedMissingActions={selectedMissingActions}
          isApplying={isApplying}
          onToggleAdded={toggleAddedSelection}
          onToggleMissing={toggleMissingSelection}
          onToggleMissingAction={toggleMissingAction}
          onToggleAllAdded={toggleAllAdded}
          onToggleAllMissing={toggleAllMissing}
          onApply={() => void handleApply()}
          onCancel={handleCancel}
        />
      )}
    </ProviderSettingsDrawer>
  )
}
