import { NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { isLinux, isWin } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { Button, Dropdown, Menu, type MenuProps } from 'antd'
import { ChevronDown, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import InstallNpxUv from './InstallNpxUv'

const mcpResources = [
  {
    name: 'Model Context Protocol Servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    logo: 'https://avatars.githubusercontent.com/u/182288589'
  },
  {
    name: 'Awesome MCP Servers',
    url: 'https://github.com/punkpeye/awesome-mcp-servers',
    logo: 'https://github.githubassets.com/assets/github-logo-55c5b9a1fe52.png'
  },
  {
    name: 'mcp.so',
    url: 'https://mcp.so/',
    logo: 'https://mcp.so/favicon.ico'
  },
  {
    name: 'modelscope.cn',
    url: 'https://www.modelscope.cn/mcp',
    logo: 'https://g.alicdn.com/sail-web/maas/2.7.35/favicon/128.ico'
  },
  {
    name: 'mcp.higress.ai',
    url: 'https://mcp.higress.ai/',
    logo: 'https://framerusercontent.com/images/FD5yBobiBj4Evn0qf11X7iQ9csk.png'
  },
  {
    name: 'smithery.ai',
    url: 'https://smithery.ai/',
    logo: 'https://smithery.ai/logo.svg'
  },
  {
    name: 'glama.ai',
    url: 'https://glama.ai/mcp/servers',
    logo: 'https://glama.ai/favicon.ico'
  },
  {
    name: 'pulsemcp.com',
    url: 'https://www.pulsemcp.com',
    logo: 'https://www.pulsemcp.com/favicon.svg'
  },
  {
    name: 'mcp.composio.dev',
    url: 'https://mcp.composio.dev/',
    logo: 'https://composio.dev/wp-content/uploads/2025/02/Fevicon-composio.png'
  }
]

export const McpSettingsNavbar = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const resourceMenuItems: MenuProps['items'] = mcpResources.map(({ name, url, logo }) => ({
    key: name,
    label: (
      <Menu.Item
        onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
        style={{ backgroundColor: 'transparent' }}
        icon={<img src={logo} alt={name} style={{ width: 20, height: 20, borderRadius: 5, marginRight: 10 }} />}>
        {name}
      </Menu.Item>
    )
  }))

  return (
    <NavbarRight style={{ paddingRight: useFullscreen() ? '12px' : isWin ? 150 : isLinux ? 120 : 12 }}>
      <HStack alignItems="center" gap={5}>
        <Button
          size="small"
          type="text"
          onClick={() => navigate('/settings/mcp/npx-search')}
          icon={<Search size={14} />}
          className="nodrag"
          style={{ fontSize: 13, height: 28, borderRadius: 20 }}>
          {t('settings.mcp.searchNpx')}
        </Button>
        <Dropdown menu={{ items: resourceMenuItems }} trigger={['click']}>
          <Button
            size="small"
            type="text"
            className="nodrag"
            style={{ fontSize: 13, height: 28, borderRadius: 20, display: 'flex', alignItems: 'center' }}>
            {t('settings.mcp.findMore')}
            <ChevronDown size={16} />
          </Button>
        </Dropdown>
        <InstallNpxUv mini />
      </HStack>
    </NavbarRight>
  )
}
