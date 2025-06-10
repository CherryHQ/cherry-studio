import { ArrowLeftOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { SettingContainer } from '@renderer/pages/settings'
import { Button } from 'antd'
import { FC } from 'react'
// import { useTranslation } from 'react-i18next'
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
  // const { t } = useTranslation()

  const location = useLocation()
  const pathname = location.pathname
  const isHome = pathname.includes('*')

  return (
    <Container theme={theme} style={{ padding: 0, position: 'relative' }}>
      {/* <NavbarMain> */}
      {/* <NavbarCenter style={{ borderRight: 'none' }}> */}
      <div className="flex">
        <HStack alignItems="center" gap={10}>
          {/* {t('common.mcp')} */}
          {!isHome && (
            <Link to="*">
              <Button type="default" icon={<ArrowLeftOutlined />} shape="circle" size="small" className="nodrag" />
            </Link>
          )}
        </HStack>
        {/* </NavbarCenter> */}
        <McpSettingsNavbar />
      </div>
      {/* </NavbarMain> */}
      <MainContainer id="content-container">
        <Routes>
          <Route path="*" element={<McpServersList />} />
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

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
`

export default McpServersPage
