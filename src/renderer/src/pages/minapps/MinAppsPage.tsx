import { Button } from '@cherrystudio/ui'
import { Navbar, NavbarMain } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useAppDispatch } from '@renderer/store'
import { moveMinApp } from '@renderer/store/minapps'
import { Input } from 'antd'
import { Search, SettingsIcon } from 'lucide-react'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CategorySection from './components/CategorySection'
import MinappSettingsPopup from './MiniappSettings/MinappSettingsPopup'
import NewAppButton from './NewAppButton'

type CategoryId = 'pinned' | 'enabled' | 'disabled'

const AppsPage: FC = () => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { minapps, pinned, disabled } = useMinapps()
  const { isTopNavbar } = useNavbarPosition()
  const dispatch = useAppDispatch()

  // Filter apps for each category
  const filteredApps = search
    ? minapps.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : minapps

  const filteredPinned = search
    ? pinned.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : pinned

  const filteredDisabled = search
    ? disabled.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : disabled

  // Handle drag and drop between categories
  const handleDrop = (e: React.DragEvent, targetId: CategoryId) => {
    const appId = e.dataTransfer.getData('text/plain')
    if (!appId) return

    // Find which category the app is coming from
    const fromPinned = pinned.some((app) => app.id === appId)
    const fromEnabled = minapps.some((app) => app.id === appId)
    const fromDisabled = disabled.some((app) => app.id === appId)

    let from: CategoryId | null = null
    if (fromPinned) from = 'pinned'
    else if (fromEnabled) from = 'enabled'
    else if (fromDisabled) from = 'disabled'

    if (from && from !== targetId) {
      dispatch(moveMinApp({ appId, from, to: targetId }))
    }
  }

  // Disable right-click menu in blank area
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <Container onContextMenu={handleContextMenu}>
      <Navbar>
        <NavbarMain>
          {t('minapp.title')}
          <Input
            placeholder={t('common.search')}
            className="nodrag"
            style={{
              width: '30%',
              height: 28,
              borderRadius: 15
            }}
            size="small"
            variant="filled"
            suffix={<Search size={18} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="ghost" className="nodrag" onClick={MinappSettingsPopup.show}>
            <SettingsIcon size={18} color="var(--color-text-2)" />
          </Button>
        </NavbarMain>
      </Navbar>
      <ContentContainer id="content-container">
        <MainContainer>
          <RightContainer>
            {isTopNavbar && (
              <HeaderContainer>
                <Input
                  placeholder={t('common.search')}
                  className="nodrag"
                  style={{ width: '30%', borderRadius: 15 }}
                  variant="filled"
                  suffix={<Search size={18} />}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button variant="ghost" className="nodrag" onClick={() => MinappSettingsPopup.show()}>
                  <SettingsIcon size={18} color="var(--color-text-2)" />
                </Button>
              </HeaderContainer>
            )}
            <AppsContainerWrapper>
              <CategorySectionsContainer>
                {filteredPinned.length > 0 && (
                  <CategorySection
                    id="pinned"
                    title={t('settings.miniapps.pinned')}
                    apps={filteredPinned}
                    onDrop={handleDrop}
                  />
                )}
                <CategorySection
                  id="enabled"
                  title={t('settings.miniapps.visible')}
                  apps={filteredApps}
                  onDrop={handleDrop}
                />
                <NewAppButton />
                {filteredDisabled.length > 0 && (
                  <CategorySection
                    id="disabled"
                    title={t('settings.miniapps.disabled')}
                    apps={filteredDisabled}
                    onDrop={handleDrop}
                  />
                )}
              </CategorySectionsContainer>
            </AppsContainerWrapper>
          </RightContainer>
        </MainContainer>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  height: 100%;
`

const HeaderContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  height: 60px;
  width: 100%;
  gap: 10px;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: calc(100vh - var(--navbar-height));
  width: 100%;
`

const RightContainer = styled(Scrollbar)`
  display: flex;
  flex: 1 1 0%;
  min-width: 0;
  flex-direction: column;
  height: 100%;
  align-items: center;
  height: calc(100vh - var(--navbar-height));
`

const AppsContainerWrapper = styled(Scrollbar)`
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 50px 0;
  width: 100%;
  margin-bottom: 20px;
  [navbar-position='top'] & {
    padding: 20px 0;
  }
`

const CategorySectionsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 30px;
  max-width: 930px;
  width: 100%;
  margin: 0 20px;
`

export default AppsPage
