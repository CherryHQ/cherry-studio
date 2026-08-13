import { ButtonGroup } from '@cherrystudio/ui'
import { isManagedCherryAiProviderId } from '@shared/data/presets/cherryai'
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
}

function ModelListContent({
  providerId,
  modelPullGuideVersion = 0
}: {
  providerId: string
  modelPullGuideVersion?: number
}) {
  const { isHealthChecking } = useModelListHealthRun()
  const disabled = isHealthChecking
  // The managed CherryAI provider is protected default data, so its model list
  // is read-only — no pull/add/download toolbar actions.
  const isManagedReadOnly = isManagedCherryAiProviderId(providerId)

  return (
    <>
      <ProviderModelList
        providerId={providerId}
        disabled={disabled}
        actions={({ disabled: toolbarDisabled }) =>
          isManagedReadOnly ? null : (
            <ButtonGroup className={modelListClasses.toolbarButtonGroup}>
              <ProviderModelPullReconcile
                providerId={providerId}
                disabled={toolbarDisabled}
                guideVersion={modelPullGuideVersion}
              />
              {providerId === 'ovms' ? (
                <ProviderModelDownload providerId={providerId} disabled={toolbarDisabled} />
              ) : (
                <ProviderModelAdd providerId={providerId} disabled={toolbarDisabled} />
              )}
            </ButtonGroup>
          )
        }
      />
      <ProviderModelHealthCheck disabled={disabled} hasVisibleModels={false} renderTrigger={false} />
    </>
  )
}

const ModelList: React.FC<ModelListProps> = ({ providerId, modelPullGuideVersion = 0 }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListContent providerId={providerId} modelPullGuideVersion={modelPullGuideVersion} />
      </section>
    </div>
  )
}

export default memo(ModelList)
