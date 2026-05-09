import { Avatar, AvatarFallback, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { getModelLogo } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { getModelClipboardId } from '@renderer/pages/settings/ProviderSettingsV2/ModelList/utils'
import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { FreeTrialModelTagV2 } from '../components/FreeTrialModelTagV2'
import ModelTagsWithLabelV2 from '../components/ModelTagsWithLabelV2'
import { modelListClasses } from '../shared/primitives/ProviderSettingsPrimitives'

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  disabled?: boolean
  onEdit: (model: Model) => void
  onToggleEnabled: (model: Model, enabled: boolean) => Promise<void>
}

const logger = loggerService.withContext('ModelListItem')

const ModelListItem: React.FC<ModelListItemProps> = ({ ref, model, disabled, onEdit, onToggleEnabled }) => {
  const { t } = useTranslation()

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

  const handleEdit = useCallback(() => {
    onEdit(model)
  }, [model, onEdit])

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      void onToggleEnabled(model, enabled)
    },
    [model, onToggleEnabled]
  )

  return (
    <div ref={ref} className={cn(modelListClasses.row, !model.isEnabled && 'opacity-60')} onClick={handleEdit}>
      <RowFlex className={modelListClasses.rowMain}>
        {(() => {
          const Icon = getModelLogo(model)
          return Icon ? (
            <Icon.Avatar size={26} />
          ) : (
            <Avatar className={modelListClasses.rowAvatar}>
              <AvatarFallback>{model.name?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
          )
        })()}
        <div className={modelListClasses.rowBody}>
          <Tooltip content={t('settings.models.copy_model_id_tooltip', { id: copyId })} placement="top">
            <span
              className={cn(
                'block min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]',
                modelListClasses.rowNameCopyable
              )}
              onClick={handleCopyName}>
              {model.name}
            </span>
          </Tooltip>
        </div>
      </RowFlex>
      <RowFlex className={modelListClasses.rowActions}>
        <div className={modelListClasses.rowActionsCluster}>
          <div className={modelListClasses.rowCapabilityStrip}>
            <ModelTagsWithLabelV2 model={model} size={8} showLabel={false} style={{ flexWrap: 'nowrap' }} />
            <FreeTrialModelTagV2 modelId={model.id} providerId={model.providerId} />
          </div>
          <div onClick={(event) => event.stopPropagation()}>
            <Switch
              checked={model.isEnabled}
              disabled={disabled}
              size="sm"
              aria-label={t('common.enabled')}
              onCheckedChange={handleToggleEnabled}
            />
          </div>
        </div>
      </RowFlex>
    </div>
  )
}

export default memo(ModelListItem)
