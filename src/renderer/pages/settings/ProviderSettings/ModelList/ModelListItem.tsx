import { Bolt, Minus } from 'lucide-react'
import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import ModelListRow from '@renderer/components/ModelListRow'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'

import { FreeTrialModelTag } from '../components/FreeTrialModelTag'
import ModelTagsWithLabel from '../components/ModelTagsWithLabel'
import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { getModelOperationErrorMessage } from './errorMessage'
import ModelCheckStatus from './ModelCheckStatus'

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  provider?: Provider
  disabled?: boolean
  isDefaultModel?: boolean
  modelStatus?: ModelWithStatus
  apiKeyEntries?: readonly ApiKeyEntry[]
  savingKeyId?: string | null
  onToggleApiKey?: (keyId: string, enabled: boolean) => Promise<void>
  onEdit: (model: Model) => void
  onDelete: (model: Model) => Promise<void>
}

const ModelListItem: React.FC<ModelListItemProps> = ({
  ref,
  model,
  provider,
  disabled,
  isDefaultModel,
  modelStatus,
  apiKeyEntries = [],
  savingKeyId = null,
  onToggleApiKey,
  onEdit,
  onDelete
}) => {
  const { t } = useTranslation()
  const deleteTooltip = isDefaultModel
    ? t('settings.models.manage.default_model_cannot_remove')
    : t('settings.models.manage.remove_model')

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
    <ModelListRow ref={ref} model={model}>
      <div className={modelListClasses.rowActionsCluster}>
        <div className={modelListClasses.rowCapabilityStrip}>
          <div className={modelListClasses.rowCapabilityTagCluster}>
            <ModelTagsWithLabel model={model} provider={provider} size={12} style={{ flexWrap: 'nowrap' }} />
          </div>
          <FreeTrialModelTag modelId={model.id} providerId={model.providerId} />
        </div>
        <div className={modelListClasses.rowInlineActions}>
          {modelStatus && onToggleApiKey ? (
            <ModelCheckStatus
              result={modelStatus}
              apiKeyEntries={apiKeyEntries}
              savingKeyId={savingKeyId}
              onToggleKey={onToggleApiKey}
            />
          ) : null}
          <Tooltip content={t('common.settings')} placement="top">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={modelListClasses.rowActionButton}
              aria-label={t('common.settings')}
              disabled={disabled}
              onClick={handleEdit}>
              <Bolt className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={deleteTooltip} placement="top">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={`${modelListClasses.rowActionButton} ${modelListClasses.rowDangerActionButton}`}
              aria-label={t('settings.models.manage.remove_model')}
              disabled={disabled || isDefaultModel}
              onClick={handleDelete}>
              <Minus className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </ModelListRow>
  )
}

export default memo(ModelListItem)
