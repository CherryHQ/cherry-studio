import { NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { isWindows } from '@renderer/config/constant'
import { Button } from 'antd'
import { Search, SquareArrowOutUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import InstallNpxUv from './InstallNpxUv'

export const McpSettingsNavbar = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const onClick = () => window.open('https://mcp.so/', '_blank')

  return (
    <NavbarRight style={{ paddingRight: isWindows ? 150 : 12 }}>
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
        <Button
          size="small"
          type="text"
          onClick={onClick}
          icon={<SquareArrowOutUpRight size={14} />}
          className="nodrag"
          style={{ fontSize: 13, height: 28, borderRadius: 20 }}>
          {t('settings.mcp.findMore')}
        </Button>
        <InstallNpxUv mini />
      </HStack>
    </NavbarRight>
  )
}
