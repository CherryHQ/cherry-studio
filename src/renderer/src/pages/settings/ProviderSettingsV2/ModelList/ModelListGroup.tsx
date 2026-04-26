import { Flex } from '@cherrystudio/ui'
import CustomCollapse from '@renderer/components/CustomCollapse'
import type { Model } from '@shared/data/types/model'
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import { getModelGroupLabel } from './grouping'
import ModelListItem from './ModelListItem'
import type { ModelListGroupItem } from './useModelListSections'

interface ModelListGroupProps {
  groupName: string
  items: ModelListGroupItem[]
  isCompact: boolean
  isUltraCompact: boolean
  defaultOpen: boolean
  disabled?: boolean
  onEditModel: (model: Model) => void
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
}

const ModelListGroup: React.FC<ModelListGroupProps> = ({
  groupName,
  items,
  isCompact,
  isUltraCompact,
  defaultOpen,
  disabled,
  onEditModel,
  onToggleModel
}) => {
  const { t } = useTranslation()
  const groupLabel = getModelGroupLabel(groupName, t)

  return (
    <div className={modelListClasses.groupShell}>
      <CustomCollapse
        defaultActiveKey={defaultOpen ? ['1'] : []}
        label={
          <Flex className={modelListClasses.groupHeaderLabel}>
            <span className={modelListClasses.groupTitle}>{groupLabel}</span>
            <span className={modelListClasses.groupHeaderRule} />
            <span className={modelListClasses.groupCount}>{items.length}</span>
          </Flex>
        }
        extra={null}
        styles={{
          header: {
            padding:
              'var(--space-stack-2xs) calc(var(--padding-x-list-group) - 2px) var(--space-stack-2xs) var(--padding-x-list-group)',
            background: 'transparent'
          }
        }}
        style={{
          border: 'none',
          background: 'transparent'
        }}>
        <div className="flex min-w-0 w-full flex-col gap-1 px-3 pb-[2px] pt-[2px]">
          {items.map(({ model, modelStatus, showIdentifier }) => (
            <ModelListItem
              key={model.id}
              model={model}
              modelStatus={modelStatus}
              showIdentifier={showIdentifier}
              isCompact={isCompact}
              isUltraCompact={isUltraCompact}
              onEdit={onEditModel}
              onToggleEnabled={onToggleModel}
              disabled={disabled}
            />
          ))}
        </div>
      </CustomCollapse>
    </div>
  )
}

export default memo(ModelListGroup)
