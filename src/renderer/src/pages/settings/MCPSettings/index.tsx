import { Flex, MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { FolderCog, Package, ShoppingBag } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import {
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName,
  settingsSubmenuSectionTitleClassName
} from '..'
import { getMCPProviderLogo, getProviderDisplayName, providers } from './providers/config'

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

  return (
    <Flex className="min-w-0 flex-1">
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full min-w-0 flex-1 flex-row overflow-hidden">
        <Scrollbar className={settingsSubmenuScrollClassName}>
          <MenuList className={settingsSubmenuListClassName}>
            <MenuItem
              label={t('settings.mcp.servers', 'MCP Servers')}
              active={activeView === 'servers'}
              onClick={() => navigate({ to: '/settings/mcp/servers' })}
              icon={<McpLogo width={18} height={18} style={{ opacity: 0.8 }} />}
              className={settingsSubmenuItemClassName}
            />
            <MenuDivider className={settingsSubmenuDividerClassName} />
            <div className={settingsSubmenuSectionTitleClassName}>{t('settings.mcp.discover', 'Discover')}</div>
            <MenuItem
              label={t('settings.mcp.builtinServers', 'Built-in Servers')}
              active={activeView === 'builtin'}
              onClick={() => navigate({ to: '/settings/mcp/builtin' })}
              icon={<Package size={18} />}
              className={settingsSubmenuItemClassName}
            />
            <MenuItem
              label={t('settings.mcp.marketplaces', 'Marketplaces')}
              active={activeView === 'marketplaces'}
              onClick={() => navigate({ to: '/settings/mcp/marketplaces' })}
              icon={<ShoppingBag size={18} />}
              className={settingsSubmenuItemClassName}
            />
            <MenuDivider className={settingsSubmenuDividerClassName} />
            <div className={settingsSubmenuSectionTitleClassName}>{t('settings.mcp.providers', 'Providers')}</div>
            {providers.map((provider) => (
              <MenuItem
                key={provider.key}
                label={getProviderDisplayName(provider, t)}
                active={activeView === provider.key}
                onClick={() => navigate({ to: `/settings/mcp/${provider.key}` })}
                icon={(() => {
                  const logo = getMCPProviderLogo(provider.key)
                  return logo ? <logo.Avatar size={24} shape="circle" /> : <FolderCog size={16} />
                })()}
                className={settingsSubmenuItemClassName}
              />
            ))}
          </MenuList>
        </Scrollbar>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </Flex>
  )
}

export default MCPSettings
