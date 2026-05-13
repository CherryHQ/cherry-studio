import { Popover, PopoverContent, PopoverTrigger, Slider } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { SettingDivider } from '@renderer/pages/settings'
import { SettingRow } from '@renderer/pages/settings'
import { Settings } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const MessageGroupSettings: FC = () => {
  const [gridPopoverTrigger, setGridPopoverTrigger] = usePreference('chat.message.multi_model.grid_popover_trigger')
  const [gridColumns, setGridColumns] = usePreference('chat.message.multi_model.grid_columns')
  const { t } = useTranslation()

  const [gridColumnsValue, setGridColumnsValue] = useState(gridColumns)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Settings className="ml-1.5 cursor-pointer" size={16} />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <div>
          <SettingRow>
            <div className="mr-2.5">{t('settings.messages.grid_popover_trigger.label')}</div>
            <Selector
              size={14}
              value={gridPopoverTrigger || 'hover'}
              onChange={(value) => setGridPopoverTrigger(value)}
              options={[
                { label: t('settings.messages.grid_popover_trigger.hover'), value: 'hover' },
                { label: t('settings.messages.grid_popover_trigger.click'), value: 'click' }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <div>{t('settings.messages.grid_columns')}</div>
          </SettingRow>
          <div className="flex items-center py-2">
            <Slider
              value={[gridColumnsValue]}
              className="w-full"
              onValueChange={(value) => setGridColumnsValue(value[0] ?? gridColumnsValue)}
              onValueCommit={(value) => setGridColumns(value[0] ?? gridColumnsValue)}
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

export default MessageGroupSettings
