import { Avatar, AvatarFallback, Button, RowFlex, Tooltip } from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import { getModelLogo } from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import { Bolt, Minus } from 'lucide-react'
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
}

const ModelListItem: React.FC<ModelListItemProps> = ({ ref, model, disabled, onEdit, onDelete }) => {
  const { t } = useTranslation()

  const handleEdit = useCallback(() => {
    onEdit(model)
  }, [model, onEdit])

  const handleDelete = useCallback(() => {
    void onDelete(model).catch((error) => {
      toast.error(
        getModelOperationErrorMessage(error, {
          fallback: t('settings.models.manage.operation_failed'),
          modelInUseByKnowledgeBase: t('settings.models.manage.model_in_use_by_knowledge_base'),
          modelInUseAsDefault: t('settings.models.manage.sync_apply_default_in_use')
        })
      )
    })
  }, [model, onDelete, t])

  return (
    <div ref={ref} className={modelListClasses.row}>
      <RowFlex className={modelListClasses.rowMain}>
        {(() => {
          const Icon = getModelLogo(model)
          return Icon ? (
            <span className={modelListClasses.rowAvatar}>
              <Icon.Avatar size={30} shape="rounded" />
            </span>
          ) : (
            <Avatar className={modelListClasses.rowAvatar}>
              <AvatarFallback className="rounded-[inherit]">{model.name?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
          )
        })()}
        <div className={modelListClasses.rowBody}>
          <div className="flex h-7 min-w-0 items-center gap-1.5">
            <span className="inline-flex h-7 min-w-0 shrink select-text items-center overflow-hidden text-ellipsis whitespace-nowrap text-left font-normal text-foreground/90 text-sm leading-none">
              {model.name}
            </span>
          </div>
        </div>
      </RowFlex>
      <RowFlex className={modelListClasses.rowActions}>
        <div className={modelListClasses.rowActionsCluster}>
          <div className={modelListClasses.rowCapabilityStrip}>
            <div className={modelListClasses.rowCapabilityTagCluster}>
              <ModelTagsWithLabel model={model} size={12} style={{ flexWrap: 'nowrap' }} />
            </div>
            <FreeTrialModelTag modelId={model.id} providerId={model.providerId} />
          </div>
          <div className={modelListClasses.rowInlineActions}>
            <Tooltip content={t('common.settings')} placement="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={modelListClasses.rowActionButton}
                aria-label={t('common.settings')}
                onClick={handleEdit}>
                <Bolt className="size-4" />
              </Button>
            </Tooltip>
            <Tooltip content={t('settings.models.manage.remove_model')} placement="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={`${modelListClasses.rowActionButton} ${modelListClasses.rowDangerActionButton}`}
                aria-label={t('settings.models.manage.remove_model')}
                disabled={disabled}
                onClick={handleDelete}>
                <Minus className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </RowFlex>
    </div>
  )
}

export default memo(ModelListItem)
