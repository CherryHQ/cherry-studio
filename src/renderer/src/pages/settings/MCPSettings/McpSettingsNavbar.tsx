import { NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { isLinux, isWin } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { Button } from 'antd'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import InstallNpxUv from './InstallNpxUv'

export const McpSettingsNavbar = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

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
        <InstallNpxUv mini />
      </HStack>
    </NavbarRight>
  )
}
