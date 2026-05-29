import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import ModelSyncPreviewPanel from './ModelSyncPreviewPanel'
import type { ModelSyncPreviewResponse } from './modelSyncPreviewTypes'
import type { ModelPullApplyPayload } from './useModelListSyncSelections'

interface ModelListSyncDrawerProps {
  open: boolean
  preview: ModelSyncPreviewResponse | null
  isApplying: boolean
  onApply: (payload: ModelPullApplyPayload) => void | Promise<void>
  onClose: () => void
}

export default function ModelListSyncDrawer({ open, preview, isApplying, onApply, onClose }: ModelListSyncDrawerProps) {
  const { t } = useTranslation()

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
      {preview ? (
        <ModelSyncPreviewPanel preview={preview} isApplying={isApplying} onApply={onApply} onCancel={onClose} />
      ) : null}
    </ProviderSettingsDrawer>
  )
}
