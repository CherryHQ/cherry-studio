import { MenuItem, MenuList } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChannelDetail from './ChannelDetail'
import { AVAILABLE_CHANNELS, type AvailableChannel } from './channelTypes'
const ChannelsSettings: FC = () => {
  const { t } = useTranslation()
  const [selectedType, setSelectedType] = useState<AvailableChannel>(AVAILABLE_CHANNELS[0])

  return (
    <div className="flex flex-1">
      <div
        className="flex w-full flex-1 flex-row overflow-hidden"
        style={{ height: 'calc(100vh - var(--navbar-height) - 6px)' }}>
        <Scrollbar
          className="border-(--color-border) border-r-[0.5px]"
          style={{ width: 'var(--settings-width)', height: 'calc(100vh - var(--navbar-height))' }}>
          <MenuList className="min-h-full p-3 pb-12">
            {AVAILABLE_CHANNELS.map((ch) => {
              const iconSrc = getChannelTypeIcon(ch.type)
              return (
                <MenuItem
                  key={ch.type}
                  label={t(ch.titleKey)}
                  active={selectedType.type === ch.type}
                  onClick={() => setSelectedType(ch)}
                  icon={
                    iconSrc ? <img src={iconSrc} alt={ch.name} className="h-5 w-5 rounded object-contain" /> : undefined
                  }
                  className="rounded-lg font-medium"
                />
              )
            })}
          </MenuList>
        </Scrollbar>
        <div className="relative flex-1">
          <ChannelDetail key={selectedType.type} channelDef={selectedType} />
        </div>
      </div>
    </div>
  )
}

export default ChannelsSettings
