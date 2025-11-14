import { ArrowLeftOutlined } from '@ant-design/icons'
import Ai302ProviderLogo from '@renderer/assets/images/providers/302ai.webp'
import BailianProviderLogo from '@renderer/assets/images/providers/bailian.png'
import LanyunProviderLogo from '@renderer/assets/images/providers/lanyun.png'
import MCPRouterProviderLogo from '@renderer/assets/images/providers/mcprouter.webp'
import ModelScopeProviderLogo from '@renderer/assets/images/providers/modelscope.png'
import TokenFluxProviderLogo from '@renderer/assets/images/providers/tokenflux.png'
import DividerWithText from '@renderer/components/DividerWithText'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { Button, Flex } from 'antd'
import { FolderCog, Package, ShoppingBag } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer } from '..'
import BuiltinMCPServerList from './BuiltinMCPServerList'
import InstallNpxUv from './InstallNpxUv'
import McpMarketList from './McpMarketList'
import ProviderDetail from './McpProviderSettings'
import McpServersList from './McpServersList'
import McpSettings from './McpSettings'
import NpxSearch from './NpxSearch'
import { providers } from './providers/config'

const MCPSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { mcpServers } = useMCPServers()
  const navigate = useNavigate()
  const location = useLocation()

  // 获取当前激活的页面
  const getActiveView = () => {
    const path = location.pathname

    // 精确匹配路径
    if (path === '/settings/mcp/builtin') return 'builtin'
    if (path === '/settings/mcp/marketplaces') return 'marketplaces'

    // 检查是否是服务商页面 - 精确匹配
    for (const provider of providers) {
      if (path === `/settings/mcp/${provider.key}`) {
        return provider.key
      }
    }

    // 其他所有情况（包括 servers、settings/:serverId、npx-search、mcp-install）都属于 servers
    return 'servers'
  }

  const activeView = getActiveView()

  // 判断是否为主页面（是否显示返回按钮）
  const isHomePage = () => {
    const path = location.pathname
    // 主页面不显示返回按钮
    if (path === '/settings/mcp' || path === '/settings/mcp/servers') return true
    if (path === '/settings/mcp/builtin' || path === '/settings/mcp/marketplaces') return true

    // 服务商页面也是主页面
    return providers.some((p) => path === `/settings/mcp/${p.key}`)
  }

  // Provider icons map
  const providerIcons: Record<string, React.ReactNode> = {
    modelscope: <ProviderIcon src={ModelScopeProviderLogo} alt="ModelScope" />,
    tokenflux: <ProviderIcon src={TokenFluxProviderLogo} alt="TokenFlux" />,
    lanyun: <ProviderIcon src={LanyunProviderLogo} alt="Lanyun" />,
    '302ai': <ProviderIcon src={Ai302ProviderLogo} alt="302AI" />,
    bailian: <ProviderIcon src={BailianProviderLogo} alt="Bailian" />,
    mcprouter: <ProviderIcon src={MCPRouterProviderLogo} alt="MCPRouter" />
  }

  return (
    <Container>
      <MainContainer>
        <MenuList>
          <ListItem
            title={t('settings.mcp.servers', 'MCP Servers')}
            active={activeView === 'servers'}
            onClick={() => navigate('/settings/mcp/servers')}
            icon={<FolderCog size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <DividerWithText text={t('settings.mcp.discover', 'Discover')} style={{ margin: '10px 0 8px 0' }} />
          <ListItem
            title={t('settings.mcp.builtinServers', 'Built-in Servers')}
            active={activeView === 'builtin'}
            onClick={() => navigate('/settings/mcp/builtin')}
            icon={<Package size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <ListItem
            title={t('settings.mcp.marketplaces', 'Marketplaces')}
            active={activeView === 'marketplaces'}
            onClick={() => navigate('/settings/mcp/marketplaces')}
            icon={<ShoppingBag size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <DividerWithText text={t('settings.mcp.providers', 'Providers')} style={{ margin: '10px 0 8px 0' }} />
          {providers.map((provider) => (
            <ListItem
              key={provider.key}
              title={provider.name}
              active={activeView === provider.key}
              onClick={() => navigate(`/settings/mcp/${provider.key}`)}
              icon={providerIcons[provider.key] || <FolderCog size={16} />}
              titleStyle={{ fontWeight: 500 }}
            />
          ))}
        </MenuList>
        <RightContainer>
          {!isHomePage() && (
            <BackButtonContainer>
              <Link to="/settings/mcp/servers">
                <Button type="default" shape="circle" size="small">
                  <ArrowLeftOutlined />
                </Button>
              </Link>
            </BackButtonContainer>
          )}
          <Routes>
            <Route index element={<Navigate to="servers" replace />} />
            <Route path="servers" element={<McpServersList />} />
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
            <Route
              path="builtin"
              element={
                <ContentWrapper>
                  <BuiltinMCPServerList />
                </ContentWrapper>
              }
            />
            <Route
              path="marketplaces"
              element={
                <ContentWrapper>
                  <McpMarketList />
                </ContentWrapper>
              }
            />
            {providers.map((provider) => (
              <Route
                key={provider.key}
                path={provider.key}
                element={<ProviderDetail provider={provider} existingServers={mcpServers} />}
              />
            ))}
          </Routes>
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

const ProviderIcon = styled.img`
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 50%;
  background-color: var(--color-background-soft);
`

const ContentWrapper = styled.div`
  padding: 20px;
  overflow-y: auto;
  height: 100%;
`

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

export default MCPSettings
