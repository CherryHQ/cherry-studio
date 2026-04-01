import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { Flex } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChannelDetail from './ChannelDetail'
import { AVAILABLE_CHANNELS, type AvailableChannel } from './channelTypes'

const TITLE_STYLE = { fontWeight: 500 } as const

const ChannelsSettings: FC = () => {
  const { t } = useTranslation()
  const [selectedType, setSelectedType] = useState<AvailableChannel>(AVAILABLE_CHANNELS[0])

  return (
    <Container>
      <MainContainer>
        <MenuList>
          {AVAILABLE_CHANNELS.map((ch) => {
            const iconSrc = getChannelTypeIcon(ch.type)
            return (
              <ListItem
                key={ch.type}
                title={t(ch.titleKey)}
                active={selectedType.type === ch.type}
                onClick={() => setSelectedType(ch)}
                icon={iconSrc ? <ChannelIcon src={iconSrc} alt={ch.name} /> : undefined}
                subtitle={ch.available ? t(ch.description) : t('agent.cherryClaw.channels.comingSoon')}
                titleStyle={TITLE_STYLE}
              />
            )
          })}
        </MenuList>
        <RightContainer>
          <ChannelDetail key={selectedType.type} channelDef={selectedType} />
        </RightContainer>
      </MainContainer>
    </Container>
  )
}

const Container = styled(Flex)`
  flex: 1;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  width: 100%;
  height: calc(100vh - var(--navbar-height) - 6px);
  overflow: hidden;
`

const MenuList = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  padding-bottom: 48px;
  border-right: 0.5px solid var(--color-border);
  height: calc(100vh - var(--navbar-height));
`

const RightContainer = styled.div`
  flex: 1;
  position: relative;
`

const ChannelIcon = styled.img`
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
`

export default ChannelsSettings
