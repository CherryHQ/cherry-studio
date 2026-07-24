import { Button, ButtonGroupItem } from '@cherrystudio/ui'
import { ArrowRight, RefreshCw } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelListSyncDrawer from './ModelListSyncDrawer'
import type { useProviderModelPullReconcile } from './useProviderModelPullReconcile'

interface ProviderModelPullReconcileProps {
  disabled: boolean
  guideVersion?: number
  pullReconcile: ReturnType<typeof useProviderModelPullReconcile>
}

const ProviderModelPullReconcile: React.FC<ProviderModelPullReconcileProps> = ({
  disabled,
  guideVersion = 0,
  pullReconcile
}) => {
  const { t } = useTranslation()
  const [showPullGuide, setShowPullGuide] = useState(false)
  const pullGuideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showPullGuideBriefly = useCallback(() => {
    setShowPullGuide(true)

    if (pullGuideTimerRef.current) {
      clearTimeout(pullGuideTimerRef.current)
    }

    pullGuideTimerRef.current = setTimeout(() => {
      setShowPullGuide(false)
      pullGuideTimerRef.current = null
    }, 1200)
  }, [])
  const openPullReconcile = useCallback(() => {
    setShowPullGuide(false)
    pullReconcile.openPullReconcile()
  }, [pullReconcile])

  useEffect(() => {
    return () => {
      if (pullGuideTimerRef.current) {
        clearTimeout(pullGuideTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (guideVersion > 0) {
      showPullGuideBriefly()
    }
  }, [guideVersion, showPullGuideBriefly])

  return (
    <>
      <ButtonGroupItem className={modelListClasses.fetchGuideWrap}>
        {showPullGuide ? (
          <span className={modelListClasses.fetchGuideArrow} aria-hidden="true" data-testid="model-pull-guide-arrow">
            <ArrowRight className="size-4" strokeWidth={2.5} />
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={modelListClasses.fetchActionButton}
          disabled={disabled || pullReconcile.isBusy}
          loading={pullReconcile.isBusy}
          onClick={openPullReconcile}>
          {pullReconcile.isBusy ? null : <RefreshCw className={modelListClasses.toolbarDesignIcon} />}
          <span>{t('settings.models.toolbar.pull_short')}</span>
        </Button>
      </ButtonGroupItem>
      <ModelListSyncDrawer
        open={pullReconcile.pullReconcileDrawerOpen}
        provider={pullReconcile.provider}
        allModels={[...pullReconcile.allModels]}
        localModels={[...pullReconcile.localModels]}
        removableModelIds={pullReconcile.removableModelIds}
        defaultModelIds={pullReconcile.defaultModelIds}
        isLoading={pullReconcile.isLoadingModels}
        isApplying={pullReconcile.isApplyingPullReconcile}
        loadErrorMessage={pullReconcile.loadErrorMessage}
        staleModelCount={pullReconcile.staleModelCount}
        staleModelIds={pullReconcile.staleModelIds}
        onRetryLoadModels={pullReconcile.reloadModels}
        onAddModels={async (models) => {
          await pullReconcile.addModels(models)
        }}
        onRemoveModels={pullReconcile.removeModels}
        onCleanStaleModels={pullReconcile.cleanStaleModels}
        onClose={pullReconcile.closePullReconcile}
      />
    </>
  )
}

export default ProviderModelPullReconcile
