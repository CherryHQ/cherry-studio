import { Popover, PopoverContent, PopoverTrigger, Slider } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import type { MultiModelGridPopoverTrigger } from '@shared/data/preference/preferenceTypes'
import { Settings } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageListActions, useMessageRenderConfig } from '../MessageListProvider'
import { defaultMessageRenderConfig } from '../types'

const MessageGroupSettings: FC = () => {
  const actions = useMessageListActions()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const gridPopoverTrigger = renderConfig.multiModelGridPopoverTrigger
  const gridColumns = renderConfig.multiModelGridColumns
  const { t } = useTranslation()

  const [gridColumnsValue, setGridColumnsValue] = useState(gridColumns)

  useEffect(() => {
    setGridColumnsValue(gridColumns)
  }, [gridColumns])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Settings className="ml-1.5 cursor-pointer" size={16} />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <div>
          <SettingsRow>
            <div className="mr-2.5">{t('settings.messages.grid_popover_trigger.label')}</div>
            <Selector
              size={14}
              value={gridPopoverTrigger || 'hover'}
              onChange={(value) =>
                actions.updateRenderConfig?.({
                  multiModelGridPopoverTrigger: value as MultiModelGridPopoverTrigger
                })
              }
              options={[
                { label: t('settings.messages.grid_popover_trigger.hover'), value: 'hover' },
                { label: t('settings.messages.grid_popover_trigger.click'), value: 'click' }
              ]}
            />
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow>
            <div>{t('settings.messages.grid_columns')}</div>
          </SettingsRow>
          <div className="flex items-center py-2">
            <Slider
              value={[gridColumnsValue]}
              className="w-full"
              onValueChange={(value) => setGridColumnsValue(value[0] ?? gridColumnsValue)}
              onValueCommit={(value) =>
                actions.updateRenderConfig?.({ multiModelGridColumns: value[0] ?? gridColumnsValue })
              }
              min={2}
              max={6}
              step={1}
              showValueLabel
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const SettingsRow = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex min-h-9 items-center justify-between gap-3', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const SettingsDivider = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['my-1 h-px bg-border', className].filter(Boolean).join(' ')} {...props} />
)

export default MessageGroupSettings
