import { ButtonGroup } from '@cherrystudio/ui'
import React, { memo } from 'react'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { useModelListHealthRun } from './modelListHealthContext'
import ProviderModelAdd from './ProviderModelAdd'
import ProviderModelDownload from './ProviderModelDownload'
import ProviderModelHealthCheck from './ProviderModelHealthCheck'
import ProviderModelList from './ProviderModelList'
import ProviderModelPullReconcile from './ProviderModelPullReconcile'

interface ModelListProps {
  providerId: string
  modelPullGuideVersion?: number
  allowManualModelAdd?: boolean
}

function ModelListContent({
  providerId,
  modelPullGuideVersion = 0,
  allowManualModelAdd
}: {
  providerId: string
  modelPullGuideVersion?: number
  allowManualModelAdd: boolean
}) {
  const { isHealthChecking } = useModelListHealthRun()
  const disabled = isHealthChecking

  return (
    <>
      <ProviderModelList
        providerId={providerId}
        disabled={disabled}
        actions={({ disabled: toolbarDisabled }) => (
          <ButtonGroup className={modelListClasses.toolbarButtonGroup}>
            <ProviderModelPullReconcile
              providerId={providerId}
              disabled={toolbarDisabled}
              guideVersion={modelPullGuideVersion}
            />
            {providerId === 'ovms' ? (
              <ProviderModelDownload providerId={providerId} disabled={toolbarDisabled} />
            ) : allowManualModelAdd ? (
              <ProviderModelAdd providerId={providerId} disabled={toolbarDisabled} />
            ) : null}
          </ButtonGroup>
        )}
      />
      <ProviderModelHealthCheck disabled={disabled} hasVisibleModels={false} renderTrigger={false} />
    </>
  )
}

const ModelList: React.FC<ModelListProps> = ({ providerId, modelPullGuideVersion = 0, allowManualModelAdd = true }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListContent
          providerId={providerId}
          modelPullGuideVersion={modelPullGuideVersion}
          allowManualModelAdd={allowManualModelAdd}
        />
      </section>
    </div>
  )
}

export default memo(ModelList)
