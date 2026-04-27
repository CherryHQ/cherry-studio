import { Avatar, AvatarFallback, RowFlex, Switch } from '@cherrystudio/ui'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { type HealthResult, HealthStatusIndicator } from '@renderer/components/HealthStatusIndicator'
import { getModelLogo } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { cn } from '@renderer/utils'
import { maskApiKey } from '@renderer/utils/api'
import type { Model } from '@shared/data/types/model'
import React, { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { FreeTrialModelTagV2 } from '../components/FreeTrialModelTagV2'
import ModelTagsWithLabelV2 from '../components/ModelTagsWithLabelV2'
import { modelListClasses } from '../components/ProviderSettingsPrimitives'

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  modelStatus: ModelWithStatus | undefined
  showIdentifier?: boolean
  disabled?: boolean
  onEdit: (model: Model) => void
  onToggleEnabled: (model: Model, enabled: boolean) => Promise<void>
}

const ModelListItem: React.FC<ModelListItemProps> = ({
  ref,
  model,
  modelStatus,
  showIdentifier = false,
  disabled,
  onEdit,
  onToggleEnabled
}) => {
  const { t } = useTranslation()
  const isChecking = modelStatus?.checking === true
  const shouldShowIdentifier = showIdentifier && model.id !== model.name

  const healthResults = useMemo(
    () =>
      modelStatus?.keyResults?.map((keyResult) => ({
        status: keyResult.status,
        latency: keyResult.latency,
        error: keyResult.error,
        label: maskApiKey(keyResult.key)
      })) || [],
    [modelStatus?.keyResults]
  )

  const hasFailedResult = useMemo(
    () => healthResults.some((result) => result.status === HealthStatus.FAILED),
    [healthResults]
  )

  const handleErrorClick = useMemo(() => {
    if (!hasFailedResult) {
      return undefined
    }

    return (result: HealthResult) => {
      if (result.error) {
        showErrorDetailPopup({ error: result.error })
      }
    }
  }, [hasFailedResult])

  const handleEdit = useCallback(() => {
    onEdit(model)
  }, [model, onEdit])

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      void onToggleEnabled(model, enabled)
    },
    [model, onToggleEnabled]
  )

  const metaLine = useMemo(() => {
    const parts: string[] = []

    if (model.pricing?.input?.perMillionTokens != null) {
      parts.push(`Input $${model.pricing.input.perMillionTokens.toFixed(2)}/M`)
    }

    if (model.pricing?.output?.perMillionTokens != null) {
      parts.push(`Output $${model.pricing.output.perMillionTokens.toFixed(2)}/M`)
    }

    if (model.contextWindow) {
      const contextLabel =
        model.contextWindow >= 1_000_000
          ? `${Math.round(model.contextWindow / 1_000_000)}M`
          : model.contextWindow >= 1_000
            ? `${Math.round(model.contextWindow / 1_000)}K`
            : `${model.contextWindow}`
      parts.push(contextLabel)
    }

    return parts.join(' · ')
  }, [model.contextWindow, model.pricing?.input?.perMillionTokens, model.pricing?.output?.perMillionTokens])

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
          <div className="flex min-w-0 items-center gap-2">
            <span className="block min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]">
              {model.name}
            </span>
            {shouldShowIdentifier && (
              <span className={modelListClasses.modelIdBadge} title={model.id}>
                {model.id}
              </span>
            )}
          </div>
          {metaLine ? <div className={modelListClasses.rowMeta}>{metaLine}</div> : null}
        </div>
      </RowFlex>
      <RowFlex className={modelListClasses.rowActions}>
        <div className={modelListClasses.healthStatusSlot}>
          <HealthStatusIndicator
            results={healthResults}
            loading={isChecking}
            showLatency
            onErrorClick={handleErrorClick}
          />
        </div>
        <div className={modelListClasses.rowActionsCluster}>
          <div className={modelListClasses.rowCapabilityStrip}>
            <ModelTagsWithLabelV2 model={model} size={11} showLabel={false} style={{ flexWrap: 'nowrap' }} />
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
