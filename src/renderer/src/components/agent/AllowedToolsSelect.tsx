import type { SelectedItems, SelectProps } from '@heroui/react'
import { Chip, cn, Select, SelectItem } from '@heroui/react'
import type { Tool } from '@renderer/types'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export interface AllowedToolsSelectProps extends Omit<SelectProps, 'children'> {
  items: Tool[]
}

export const AllowedToolsSelect: React.FC<AllowedToolsSelectProps> = (props) => {
  const { t } = useTranslation()
  const { items: availableTools, className, ...rest } = props

  const renderSelectedTools = useCallback((items: SelectedItems<Tool>) => {
    if (!items.length) {
      return null
    }
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Chip key={item.key} size="sm" variant="flat" className="max-w-[160px] truncate">
            {item.data?.name ?? item.textValue ?? item.key}
          </Chip>
        ))}
      </div>
    )
  }, [])

  return (
    <Select
      aria-label={t('agent.session.allowed_tools.label')}
      selectionMode="multiple"
      isMultiline
      label={t('agent.session.allowed_tools.label')}
      placeholder={t('agent.session.allowed_tools.placeholder')}
      description={
        availableTools.length ? t('agent.session.allowed_tools.helper') : t('agent.session.allowed_tools.empty')
      }
      isDisabled={!availableTools.length}
      items={availableTools}
      renderValue={renderSelectedTools}
      className={cn('max-w-xl', className)}
      {...rest}>
      {(tool) => (
        <SelectItem key={tool.id} textValue={tool.name}>
          <div className="flex flex-col">
            <span className="font-medium text-sm">{tool.name}</span>
            {tool.description ? <span className="text-foreground-500 text-xs">{tool.description}</span> : null}
          </div>
        </SelectItem>
      )}
    </Select>
  )
}
