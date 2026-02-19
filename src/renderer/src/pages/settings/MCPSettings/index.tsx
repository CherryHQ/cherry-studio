import { ArrowLeftOutlined } from '@ant-design/icons'
import { PROVIDER_ICON_CATALOG } from '@cherrystudio/ui'
import DividerWithText from '@renderer/components/DividerWithText'
import { McpLogo } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { Button, Flex } from 'antd'
import { FolderCog, Package, ShoppingBag } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { getProviderDisplayName, providers } from './providers/config'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
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
  const Ai302Avatar = PROVIDER_ICON_CATALOG['302ai'].Avatar
  const providerIcons: Record<string, React.ReactNode> = {
    modelscope: <PROVIDER_ICON_CATALOG.modelscope.Avatar size={24} shape="circle" />,
    tokenflux: <PROVIDER_ICON_CATALOG.tokenflux.Avatar size={24} shape="circle" />,
    lanyun: <PROVIDER_ICON_CATALOG.lanyun.Avatar size={24} shape="circle" />,
    '302ai': <Ai302Avatar size={24} shape="circle" />,
    bailian: <PROVIDER_ICON_CATALOG.bailian.Avatar size={24} shape="circle" />,
    mcprouter: <PROVIDER_ICON_CATALOG.mcprouter.Avatar size={24} shape="circle" />
  }

  return (
    <Container>
      <MainContainer>
        <MenuList>
          <ListItem
            title={t('settings.mcp.servers', 'MCP Servers')}
            active={activeView === 'servers'}
            onClick={() => navigate({ to: '/settings/mcp/servers' })}
            icon={<McpLogo width={18} height={18} style={{ opacity: 0.8 }} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <DividerWithText text={t('settings.mcp.discover', 'Discover')} style={{ margin: '10px 0 8px 0' }} />
          <ListItem
            title={t('settings.mcp.builtinServers', 'Built-in Servers')}
            active={activeView === 'builtin'}
            onClick={() => navigate({ to: '/settings/mcp/builtin' })}
            icon={<Package size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <ListItem
            title={t('settings.mcp.marketplaces', 'Marketplaces')}
            active={activeView === 'marketplaces'}
            onClick={() => navigate({ to: '/settings/mcp/marketplaces' })}
            icon={<ShoppingBag size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <DividerWithText text={t('settings.mcp.providers', 'Providers')} style={{ margin: '10px 0 8px 0' }} />
          {providers.map((provider) => (
            <ListItem
              key={provider.key}
              title={getProviderDisplayName(provider, t)}
              active={activeView === provider.key}
              onClick={() => navigate({ to: `/settings/mcp/${provider.key}` })}
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
  padding: 12px;
  padding-bottom: 48px;
  border-right: 0.5px solid var(--color-border);
  height: calc(100vh - var(--navbar-height));
`

const RightContainer = styled.div`
  flex: 1;
  position: relative;
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
