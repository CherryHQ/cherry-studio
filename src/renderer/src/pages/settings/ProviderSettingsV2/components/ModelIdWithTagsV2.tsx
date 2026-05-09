import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { ProviderSettingsDisplayModel } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { getModelClipboardId } from '@renderer/pages/settings/ProviderSettingsV2/ModelList/utils'
import { cn } from '@renderer/utils'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../shared/primitives/ProviderSettingsPrimitives'
import ModelTagsWithLabelV2 from './ModelTagsWithLabelV2'

const logger = loggerService.withContext('ModelIdWithTagsV2')

interface ModelIdWithTagsV2Props {
  model: ProviderSettingsDisplayModel
  fontSize?: React.CSSProperties['fontSize']
  showIdentifier?: boolean
  style?: React.CSSProperties
}

const ModelIdWithTagsV2 = ({
  ref,
  model,
  fontSize = 'var(--font-size-body-md)',
  showIdentifier = false,
  style
}: ModelIdWithTagsV2Props & { ref?: React.RefObject<HTMLDivElement> | null }) => {
  const { t } = useTranslation()
  const shouldShowIdentifier = showIdentifier && model.id !== model.name

  const copyId = getModelClipboardId(model)

  const handleCopyName = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      void navigator.clipboard.writeText(copyId).catch((err: unknown) => {
        logger.error('Failed to copy model id', err instanceof Error ? err : new Error(String(err)))
      })
    },
    [copyId]
  )

  return (
    <div
      ref={ref}
      className="flex min-w-0 items-center gap-1.5 text-foreground leading-[1.2]"
      style={{ fontSize, ...style }}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Tooltip content={t('settings.models.copy_model_id_tooltip', { id: copyId })} placement="top">
          <span
            className={cn(
              'block min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-medium leading-[1.3]',
              modelListClasses.rowNameCopyable
            )}
            onClick={handleCopyName}>
            {model.name}
          </span>
        </Tooltip>
        {shouldShowIdentifier && (
          <span
            className="min-w-0 max-w-[50%] shrink truncate rounded-md bg-foreground/[0.05] px-1.5 py-[1px] font-mono text-[length:var(--font-size-body-xs)]! text-muted-foreground leading-[1.2]"
            title={model.id}>
            {model.id}
          </span>
        )}
      </div>
      <ModelTagsWithLabelV2 model={model} size={8} showLabel={false} style={{ flexShrink: 0 }} />
    </div>
  )
}

export default memo(ModelIdWithTagsV2)
