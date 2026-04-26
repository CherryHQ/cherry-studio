import React, { memo } from 'react'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import { ModelListFiltersProvider } from './modelListFiltersContext'
import { ModelListHealthProvider } from './modelListHealthContext'
import ModelListHelpLinks from './ModelListHelpLinks'
import ModelListSections from './ModelListSections'
import ModelListToolbar from './ModelListToolbar'
import { useParentContentWidth } from './useParentContentWidth'

/** UI tokens: `modelListClasses` + typography helpers from ProviderSettingsPrimitives; parent supplies `.provider-settings-default-scope`. */

interface ModelListProps {
  providerId: string
}

const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  const { elementRef: sectionRef, width: containerWidth } = useParentContentWidth<HTMLElement>()

  return (
    <section
      ref={sectionRef}
      data-testid="provider-model-list"
      className={modelListClasses.section}
      style={containerWidth > 0 ? { width: containerWidth, maxWidth: '100%' } : undefined}>
      <ModelListFiltersProvider>
        <ModelListHealthProvider providerId={providerId}>
          <div className={modelListClasses.headerBlock}>
            <ModelListToolbar providerId={providerId} containerWidth={containerWidth} />
            <ModelListSections providerId={providerId} containerWidth={containerWidth} />
          </div>
        </ModelListHealthProvider>
      </ModelListFiltersProvider>
      <ModelListHelpLinks providerId={providerId} />
    </section>
  )
}

export default memo(ModelList)
