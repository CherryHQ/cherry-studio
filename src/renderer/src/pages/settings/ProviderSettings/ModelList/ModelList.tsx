import React, { memo } from 'react'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { ModelListHealthProvider } from './modelListHealthContext'
import { useModelListHealth } from './modelListHealthContext'
import ProviderModelAdd from './ProviderModelAdd'
import ProviderModelDownload from './ProviderModelDownload'
import ProviderModelHealthCheck from './ProviderModelHealthCheck'
import ProviderModelList from './ProviderModelList'
import ProviderModelPullReconcile from './ProviderModelPullReconcile'

interface ModelListProps {
  providerId: string
}

function ModelListContent({ providerId }: { providerId: string }) {
  const health = useModelListHealth()
  const disabled = health.isHealthChecking

  return (
    <ProviderModelList
      providerId={providerId}
      disabled={disabled}
      actions={({ disabled: toolbarDisabled, hasVisibleModels }) => (
        <>
          <ProviderModelHealthCheck disabled={toolbarDisabled} hasVisibleModels={hasVisibleModels} />
          <div className={modelListClasses.toolbarOutlineActions}>
            <ProviderModelPullReconcile providerId={providerId} disabled={toolbarDisabled} />
            {providerId === 'ovms' ? (
              <ProviderModelDownload providerId={providerId} disabled={toolbarDisabled} />
            ) : (
              <ProviderModelAdd providerId={providerId} disabled={toolbarDisabled} />
            )}
          </div>
        </>
      )}
    />
  )
}

const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListHealthProvider providerId={providerId}>
          <ModelListContent providerId={providerId} />
        </ModelListHealthProvider>
      </section>
    </div>
  )
}

export default memo(ModelList)
