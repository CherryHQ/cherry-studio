import { Avatar, AvatarFallback, Button, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import { Settings, Trash2 } from 'lucide-react'
import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { FreeTrialModelTag } from '../components/FreeTrialModelTag'
import ModelTagsWithLabel from '../components/ModelTagsWithLabel'
import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { getModelOperationErrorMessage } from './errorMessage'

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  disabled?: boolean
  onEdit: (model: Model) => void
  onDelete: (model: Model) => Promise<void>
  onToggleEnabled: (model: Model, enabled: boolean) => Promise<void>
}

const ModelListItem: React.FC<ModelListItemProps> = ({ ref, model, disabled, onEdit, onDelete, onToggleEnabled }) => {
  const { t } = useTranslation()

  const handleEdit = useCallback(() => {
    onEdit(model)
  }, [model, onEdit])

  const handleDelete = useCallback(() => {
    void onDelete(model).catch((error) => {
      window.toast.error(
        getModelOperationErrorMessage(error, {
          fallback: t('settings.models.manage.operation_failed'),
          modelInUseByKnowledgeBase: t('settings.models.manage.model_in_use_by_knowledge_base')
        })
      )
    })
  }, [model, onDelete, t])

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      void onToggleEnabled(model, enabled).catch(() => {
        window.toast.error(t('settings.models.manage.operation_failed'))
      })
    },
    [model, onToggleEnabled, t]
  )

  return (
    <div ref={ref} className={modelListClasses.row}>
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
          <div className="flex h-7 min-w-0 items-center gap-1.5">
            <button
              type="button"
              className={cn(
                'inline-flex h-7 min-w-0 shrink items-center overflow-hidden text-ellipsis whitespace-nowrap text-left font-normal text-foreground/90 text-sm leading-none',
                modelListClasses.rowNameCopyable
              )}
              onClick={handleEdit}>
              {model.name}
            </button>
            <Tooltip content={t('common.settings')} placement="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/35 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t('common.settings')}
                onClick={handleEdit}>
                <Settings className="size-3" />
              </Button>
            </Tooltip>
            <Tooltip content={t('settings.models.manage.remove_model')} placement="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/35 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t('settings.models.manage.remove_model')}
                disabled={disabled}
                onClick={handleDelete}>
                <Trash2 className="size-3" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </RowFlex>
      <RowFlex className={modelListClasses.rowActions}>
        <div className={modelListClasses.rowActionsCluster}>
          <div className={modelListClasses.rowCapabilityStrip}>
            <div className={modelListClasses.rowCapabilityTagCluster}>
              <ModelTagsWithLabel model={model} size={10} style={{ flexWrap: 'nowrap' }} />
            </div>
            <FreeTrialModelTag modelId={model.id} providerId={model.providerId} />
          </div>
          <div className="flex h-7 items-center" onClick={(event) => event.stopPropagation()}>
            <Switch
              checked={model.isEnabled}
              disabled={disabled}
              size="xs"
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
