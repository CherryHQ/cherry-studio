import { ArrowLeftOutlined } from '@ant-design/icons'
import { NavbarCenter, NavbarMain } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { SettingContainer } from '@renderer/pages/settings'
import { Button } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes, useLocation } from 'react-router'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import InstallNpxUv from './InstallNpxUv'
import McpServersList from './McpServersList'
import McpSettings from './McpSettings'
import { McpSettingsNavbar } from './McpSettingsNavbar'
import NpxSearch from './NpxSearch'

const McpServersPage: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()

  const location = useLocation()
  const pathname = location.pathname

  const isHome = pathname === '/mcp-servers'

  return (
    <Container theme={theme} style={{ padding: 0, position: 'relative' }}>
      <NavbarMain>
        <NavbarCenter style={{ borderRight: 'none' }}>
          <HStack alignItems="center" gap={10}>
            {t('settings.mcp.title')}
          </HStack>
        </NavbarCenter>
        {pathname.includes('/mcp-servers') && <McpSettingsNavbar />}
      </NavbarMain>
      <MainContainer id="content-container">
        {!isHome && (
          <NavigationBar>
            <Link to="/mcp-servers">
              <HStack alignItems="center" gap={10}>
                <Button type="default" icon={<ArrowLeftOutlined />} shape="circle" size="small" className="nodrag" />
                {t('common.back')}
              </HStack>
            </Link>
          </NavigationBar>
        )}
        <Routes>
          <Route path="/" element={<McpServersList />} />
          <Route path="settings" element={<McpSettings />} />
          <Route
            path="npx-search"
            element={
              <SettingContainer theme={theme}>
                <NpxSearch />
              </SettingContainer>
            }
          />
          <Route
            path="mcp-install"
            element={
              <SettingContainer theme={theme}>
                <InstallNpxUv />
              </SettingContainer>
            }
          />
        </Routes>
      </MainContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`

const MainContainer = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  overflow-y: auto;
`

const NavigationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px;
  background-color: var(--color-background);
`

export default McpServersPage
