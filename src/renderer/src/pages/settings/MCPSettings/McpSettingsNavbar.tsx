import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { NavbarRight } from '@renderer/components/app/Navbar'
import { isLinux, isWin } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import InstallNpxUv from './InstallNpxUv'

export const McpSettingsNavbar = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <NavbarRight style={{ paddingRight: useFullscreen() ? '12px' : isWin ? 150 : isLinux ? 120 : 12 }}>
      <RowFlex className="items-center gap-[5px]">
        <Button
          size="sm"
          variant="light"
          onPress={() => navigate('/settings/mcp/npx-search')}
          startContent={<Search size={14} />}
          className="nodrag h-7 rounded-[20px] text-[13px]">
          {t('settings.mcp.searchNpx')}
        </Button>
        <InstallNpxUv mini />
      </RowFlex>
    </NavbarRight>
  )
}
