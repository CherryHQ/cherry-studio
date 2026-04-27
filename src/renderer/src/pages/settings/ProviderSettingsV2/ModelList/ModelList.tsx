import React, { memo } from 'react'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import { EditModelDrawer } from './ModelDrawer'
import { ModelListFiltersProvider } from './modelListFiltersContext'
import { ModelListHealthProvider } from './modelListHealthContext'
import ModelListHelpLinks from './ModelListHelpLinks'
import ModelListSections from './ModelListSections'
import ModelListToolbar from './ModelListToolbar'
import { useModelListActions } from './useModelListActions'
import { useModelListSections } from './useModelListSections'

/** UI tokens: `modelListClasses` + typography helpers from ProviderSettingsPrimitives; parent supplies `.provider-settings-default-scope`. */

interface ModelListProps {
  providerId: string
}

function ModelListContent({ providerId }: { providerId: string }) {
  const actions = useModelListActions({ providerId })
  const sections = useModelListSections({ providerId })

  return (
    <>
      <div className={modelListClasses.headerBlock}>
        <ModelListToolbar providerId={providerId} actions={actions} />
        <ModelListSections sections={sections} />
      </div>
      <EditModelDrawer
        providerId={providerId}
        open={sections.editModelDrawerOpen}
        model={sections.editingModel}
        onClose={sections.closeEditModelDrawer}
      />
    </>
  )
}

const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListFiltersProvider>
          <ModelListHealthProvider providerId={providerId}>
            <ModelListContent providerId={providerId} />
          </ModelListHealthProvider>
        </ModelListFiltersProvider>
      </section>
      <ModelListHelpLinks providerId={providerId} />
    </div>
  )
}

export default memo(ModelList)
