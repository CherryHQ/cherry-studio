import { MenuItem, MenuList, PageHeader, RowFlex } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import {
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName
} from '@renderer/pages/settings/settingsStyles'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { Server } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChannelDetail from './ChannelDetail'
import { AVAILABLE_CHANNELS, type AvailableChannel } from './channelTypes'
import WebUiRemoteSettings from './WebUiRemoteSettings'

type SelectedChannel = AvailableChannel | 'webui'

const ChannelsSettings: FC = () => {
  const { t } = useTranslation()
  const [selectedType, setSelectedType] = useState<SelectedChannel>(AVAILABLE_CHANNELS[0])
  const [isWebUiSupported] = useSharedCache('feature.webui.supported', false)

  return (
    <RowFlex className="flex-1">
      <div className={`flex flex-col ${settingsSubmenuScrollClassName}`}>
        <PageHeader title={t('settings.channels.title')} />
        <Scrollbar className="min-h-0 flex-1">
          <MenuList className={settingsSubmenuListClassName}>
            {AVAILABLE_CHANNELS.map((ch) => {
              const iconSrc = getChannelTypeIcon(ch.type)
              return (
                <MenuItem
                  key={ch.type}
                  label={t(ch.titleKey)}
                  active={selectedType !== 'webui' && selectedType.type === ch.type}
                  onClick={() => setSelectedType(ch)}
                  icon={
                    iconSrc ? <img src={iconSrc} alt={ch.name} className="h-4 w-4 rounded object-contain" /> : undefined
                  }
                  className={settingsSubmenuItemClassName}
                  labelClassName={settingsSubmenuItemLabelClassName}
                />
              )
            })}
            {isWebUiSupported && (
              <MenuItem
                label={t('settings.webui.title')}
                active={selectedType === 'webui'}
                onClick={() => setSelectedType('webui')}
                icon={<Server size={16} />}
                className={settingsSubmenuItemClassName}
                labelClassName={settingsSubmenuItemLabelClassName}
              />
            )}
          </MenuList>
        </Scrollbar>
      </div>
      <div className="relative flex-1">
        {selectedType === 'webui' ? <WebUiRemoteSettings /> : <ChannelDetail key={selectedType.type} channelDef={selectedType} />}
      </div>
    </RowFlex>
  )
}

export default ChannelsSettings
