import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import ModelSyncPreviewPanel, { ModelSyncPreviewFooter } from './ModelSyncPreviewPanel'
import type { ModelSyncPreviewResponse } from './modelSyncPreviewTypes'
import { type ModelPullApplyPayload, useModelListSyncSelections } from './useModelListSyncSelections'

interface ModelListSyncDrawerProps {
  open: boolean
  preview: ModelSyncPreviewResponse | null
  isApplying: boolean
  onApply: (payload: ModelPullApplyPayload) => void | Promise<void>
  onClose: () => void
}

export default function ModelListSyncDrawer({ open, preview, isApplying, onApply, onClose }: ModelListSyncDrawerProps) {
  const { t } = useTranslation()
  const selections = useModelListSyncSelections(preview)

  const handleApply = useCallback(() => {
    const payload = selections.getApplyPayload()
    if (!payload) {
      return
    }
    void onApply(payload)
  }, [selections, onApply])

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.models.manage.fetch_result_title')}
      footer={
        preview ? (
          <ModelSyncPreviewFooter
            preview={preview}
            selections={selections}
            isApplying={isApplying}
            onApply={handleApply}
            onCancel={onClose}
          />
        ) : undefined
      }>
      {preview ? <ModelSyncPreviewPanel preview={preview} selections={selections} isApplying={isApplying} /> : null}
    </ProviderSettingsDrawer>
  )
}
