import { ButtonGroup } from '@cherrystudio/ui'
import React, { memo } from 'react'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
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
    <>
      <ProviderModelList
        providerId={providerId}
        disabled={disabled}
        actions={({ disabled: toolbarDisabled }) => (
          <ButtonGroup className={modelListClasses.toolbarButtonGroup}>
            <ProviderModelPullReconcile providerId={providerId} disabled={toolbarDisabled} />
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

const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListContent providerId={providerId} />
      </section>
    </div>
  )
}

export default memo(ModelList)
