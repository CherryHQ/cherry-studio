import { Settings } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import type { MultiModelGridPopoverTrigger } from '@shared/data/preference/preferenceTypes'

import { useMessageListActions, useMessageRenderConfig } from '../MessageListProvider'
import { defaultMessageRenderConfig } from '../types'

const MessageGroupSettings: FC = () => {
  const actions = useMessageListActions()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const gridPopoverTrigger = renderConfig.multiModelGridPopoverTrigger
  const { t } = useTranslation()

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

export default MessageGroupSettings
