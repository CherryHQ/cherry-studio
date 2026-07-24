import { Alert, Button, ButtonGroup } from '@cherrystudio/ui'
import { useCurrentTabId, useOptionalTabsContext } from '@renderer/hooks/tab'
import type { ConnectionModelDetectionSignal } from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/connectionModelDetection'
import React, { memo, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelDetectionLeavePopup from './ModelDetectionLeavePopup'
import { useModelListHealthRun } from './modelListHealthContext'
import ProviderModelAdd from './ProviderModelAdd'
import ProviderModelDownload from './ProviderModelDownload'
import ProviderModelHealthCheck from './ProviderModelHealthCheck'
import ProviderModelList from './ProviderModelList'
import ProviderModelPullReconcile from './ProviderModelPullReconcile'
import { useProviderModelPullReconcile } from './useProviderModelPullReconcile'

interface ModelListProps {
  providerId: string
  connectionModelDetectionSignal?: ConnectionModelDetectionSignal | null
}

interface AutoDetectedModelsNoticeProps {
  count: number
  isAdding: boolean
  onAddAll: () => void
  onDismiss: () => void
  onSelect: () => void
}

function AutoDetectedModelsNotice({ count, isAdding, onAddAll, onDismiss, onSelect }: AutoDetectedModelsNoticeProps) {
  const { t } = useTranslation()

  return (
    <Alert
      type="success"
      showIcon
      message={t('settings.models.auto_detect.message', { count })}
      description={t('settings.models.auto_detect.description')}
      action={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button type="button" variant="ghost" size="sm" disabled={isAdding} onClick={onDismiss}>
            {t('settings.models.auto_detect.dismiss')}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={isAdding} onClick={onSelect}>
            {t('settings.models.auto_detect.select')}
          </Button>
          <Button type="button" size="sm" loading={isAdding} onClick={onAddAll}>
            {t('settings.models.auto_detect.add_all')}
          </Button>
        </div>
      }
    />
  )
}

function ModelListContent({
  providerId,
  connectionModelDetectionSignal
}: {
  providerId: string
  connectionModelDetectionSignal?: ConnectionModelDetectionSignal | null
}) {
  const { isHealthChecking } = useModelListHealthRun()
  const pullReconcile = useProviderModelPullReconcile(providerId)
  const {
    addModels,
    detectedModels,
    detectModelsIfEmpty,
    dismissDetectedModels,
    invalidateAutoDetection,
    isApplyingPullReconcile,
    isAutoDetectingModels,
    localModels,
    openDetectedModels,
    pullReconcileDrawerOpen
  } = pullReconcile
  const [connectionPullGuideVersion, setConnectionPullGuideVersion] = useState(0)
  const handledConnectionSignalVersionRef = useRef(0)
  const preserveDetectedModelsForRetryRef = useRef(false)
  const currentTabId = useCurrentTabId()
  const registerTabLeaveGuard = useOptionalTabsContext()?.registerTabLeaveGuard
  const disabled = isHealthChecking

  const confirmTabLeave = useEffectEvent(async () => {
    if (!isAutoDetectingModels && detectedModels.length === 0) {
      return true
    }

    const decision = await ModelDetectionLeavePopup.show({
      count: detectedModels.length,
      phase: isAutoDetectingModels ? 'detecting' : 'detected'
    })
    const canLeave = decision === 'leave'

    if (canLeave) {
      preserveDetectedModelsForRetryRef.current = false
      invalidateAutoDetection()
    }
    return canLeave
  })

  useEffect(() => {
    if (!currentTabId || !registerTabLeaveGuard || (!isAutoDetectingModels && detectedModels.length === 0)) {
      return
    }

    return registerTabLeaveGuard(currentTabId, () => confirmTabLeave())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the Effect Event reads the latest detection state without re-registering the guard.
  }, [currentTabId, detectedModels.length, isAutoDetectingModels, registerTabLeaveGuard])

  useEffect(() => {
    if (
      !connectionModelDetectionSignal ||
      connectionModelDetectionSignal.version <= handledConnectionSignalVersionRef.current
    ) {
      return
    }

    const { intent, shouldGuideExistingModels = false, version } = connectionModelDetectionSignal
    handledConnectionSignalVersionRef.current = version
    preserveDetectedModelsForRetryRef.current = false

    if (intent === 'invalidate') {
      invalidateAutoDetection()
      return
    }

    if (localModels.length > 0) {
      invalidateAutoDetection()
      if (shouldGuideExistingModels) {
        setConnectionPullGuideVersion((current) => current + 1)
      }
      return
    }

    void detectModelsIfEmpty().then((outcome) => {
      if (
        outcome === 'existing' &&
        shouldGuideExistingModels &&
        handledConnectionSignalVersionRef.current === version
      ) {
        setConnectionPullGuideVersion((current) => current + 1)
      }
    })
  }, [connectionModelDetectionSignal, detectModelsIfEmpty, invalidateAutoDetection, localModels.length])

  useEffect(() => {
    if (
      localModels.length > 0 &&
      (isAutoDetectingModels || detectedModels.length > 0) &&
      !preserveDetectedModelsForRetryRef.current
    ) {
      invalidateAutoDetection()
    }
  }, [detectedModels.length, invalidateAutoDetection, isAutoDetectingModels, localModels.length])

  const handleAddAllDetectedModels = useCallback(async () => {
    preserveDetectedModelsForRetryRef.current = true
    const added = await addModels([...detectedModels])
    if (added) {
      preserveDetectedModelsForRetryRef.current = false
      dismissDetectedModels()
    }
  }, [addModels, detectedModels, dismissDetectedModels])

  const handleDismissDetectedModels = useCallback(() => {
    preserveDetectedModelsForRetryRef.current = false
    dismissDetectedModels()
  }, [dismissDetectedModels])

  const handleOpenDetectedModels = useCallback(() => {
    preserveDetectedModelsForRetryRef.current = false
    openDetectedModels()
  }, [openDetectedModels])

  return (
    <>
      {detectedModels.length > 0 && !pullReconcileDrawerOpen ? (
        <AutoDetectedModelsNotice
          count={detectedModels.length}
          isAdding={isApplyingPullReconcile}
          onAddAll={() => void handleAddAllDetectedModels()}
          onDismiss={handleDismissDetectedModels}
          onSelect={handleOpenDetectedModels}
        />
      ) : null}
      <ProviderModelList
        providerId={providerId}
        disabled={disabled}
        actions={({ disabled: toolbarDisabled }) => (
          <ButtonGroup className={modelListClasses.toolbarButtonGroup}>
            <ProviderModelPullReconcile
              disabled={toolbarDisabled}
              guideVersion={connectionPullGuideVersion}
              pullReconcile={pullReconcile}
            />
            {providerId === 'ovms' ? (
              <ProviderModelDownload providerId={providerId} disabled={toolbarDisabled} />
            ) : (
              <ProviderModelAdd providerId={providerId} disabled={toolbarDisabled} />
            )}
          </ButtonGroup>
        )}
      />
      <ProviderModelHealthCheck disabled={disabled} hasVisibleModels={false} renderTrigger={false} />
    </>
  )
}

const ModelList: React.FC<ModelListProps> = ({ providerId, connectionModelDetectionSignal }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListContent providerId={providerId} connectionModelDetectionSignal={connectionModelDetectionSignal} />
      </section>
    </div>
  )
}

export default memo(ModelList)
