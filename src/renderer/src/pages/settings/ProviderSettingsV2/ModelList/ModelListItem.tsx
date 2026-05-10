import { Avatar, AvatarFallback, Button, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { getModelLogo } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { getModelClipboardId } from '@renderer/pages/settings/ProviderSettingsV2/ModelList/utils'
import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import { Copy } from 'lucide-react'
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
      void onToggleEnabled(model, enabled).catch(() => {
        window.toast.error(t('settings.models.manage.operation_failed'))
      })
    },
    [model, onToggleEnabled, t]
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
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="block min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]">
              {model.name}
            </span>
            <Tooltip content={t('settings.models.copy_model_id_tooltip', { id: copyId })} placement="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-5 shrink-0 rounded-md p-0 text-muted-foreground/35 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t('settings.models.copy_model_id_tooltip', { id: copyId })}
                onClick={handleCopyName}>
                <Copy className="size-2.5" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </RowFlex>
      <RowFlex className={modelListClasses.rowActions}>
        <div className={modelListClasses.rowActionsCluster}>
          <div className={modelListClasses.rowCapabilityStrip}>
            <div className={modelListClasses.rowCapabilityTagCluster}>
              <ModelTagsWithLabelV2 model={model} size={8} showLabel={false} style={{ flexWrap: 'nowrap' }} />
            </div>
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
