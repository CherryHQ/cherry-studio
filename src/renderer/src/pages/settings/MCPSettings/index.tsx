import { ArrowLeftOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Button } from 'antd'
import { FC } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer } from '..'
import InstallNpxUv from './InstallNpxUv'
import McpServersList from './McpServersList'
import McpSettings from './McpSettings'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { theme } = useTheme()

  const location = useLocation()
  const pathname = location.pathname

  const isHome = pathname === '/settings/mcp'

  return (
    <SettingContainer theme={theme} style={{ padding: 0, position: 'relative' }}>
      {!isHome && (
        <BackButtonContainer>
          <Link to="/settings/mcp">
            <Button type="default" icon={<ArrowLeftOutlined />} shape="circle" />
          </Link>
        </BackButtonContainer>
      )}
      <MainContainer>
        <Routes>
          <Route path="/" element={<McpServersList />} />
          <Route path="settings/:serverId" element={<McpSettings />} />
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
    </SettingContainer>
  )
}

const BackButtonContainer = styled.div`
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: transparent;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
`

export default MCPSettings
