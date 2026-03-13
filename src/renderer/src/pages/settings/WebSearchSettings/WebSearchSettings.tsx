import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { Outlet } from '@tanstack/react-router'
import { Flex } from 'antd'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import WebSearchProviderListSection from './components/WebSearchProviderListSection'
import { useWebSearchSettingsNavigation } from './hooks/useWebSearchSettingsNavigation'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { activeView, apiProviders, goToGeneral, goToProvider, localProviders } = useWebSearchSettingsNavigation()

  return (
    <Container>
      <MainContainer>
        <MenuList>
          <ListItem
            title={t('settings.tool.websearch.title')}
            active={activeView === 'general'}
            onClick={goToGeneral}
            icon={<Search size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <WebSearchProviderListSection
            title={t('settings.tool.websearch.api_providers')}
            providers={apiProviders}
            activeView={activeView}
            onSelect={goToProvider}
          />
          <WebSearchProviderListSection
            title={t('settings.tool.websearch.local_providers')}
            providers={localProviders}
            activeView={activeView}
            onSelect={goToProvider}
          />
        </MenuList>
        <RightContainer>
          <Outlet />
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
  height: calc(100vh - var(--navbar-height));
  padding: 12px;
  padding-bottom: 48px;
  border-right: 0.5px solid var(--color-border);
`

const RightContainer = styled.div`
  position: relative;
  display: flex;
  flex: 1;
`

export default WebSearchSettings
