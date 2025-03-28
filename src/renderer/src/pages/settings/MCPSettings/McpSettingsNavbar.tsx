import { EditOutlined, ExportOutlined, SearchOutlined } from '@ant-design/icons'
import { NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { EventEmitter } from '@renderer/services/EventService'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

import EditMcpJsonPopup from './EditMcpJsonPopup'
import InstallNpxUv from './InstallNpxUv'

export const McpSettingsNavbar = () => {
  const { t } = useTranslation()
  const onClick = () => window.open('https://mcp.so/', '_blank')

  return (
    <NavbarRight>
      <HStack alignItems="center" gap={5}>
        <Button
          size="small"
          type="text"
          onClick={() => EventEmitter.emit('mcp:npx-search')}
          icon={<SearchOutlined />}
          className="nodrag"
          style={{ fontSize: 13, height: 28, borderRadius: 20 }}>
          {t('settings.mcp.searchNpx')}
        </Button>
        <Button
          size="small"
          type="text"
          onClick={() => EditMcpJsonPopup.show()}
          icon={<EditOutlined />}
          className="nodrag"
          style={{ fontSize: 13, height: 28, borderRadius: 20 }}>
          {t('settings.mcp.editMcpJson')}
        </Button>
        <Button
          size="small"
          type="text"
          onClick={onClick}
          icon={<ExportOutlined />}
          className="nodrag"
          style={{ fontSize: 13, height: 28, borderRadius: 20 }}>
          {t('settings.mcp.findMore')}
        </Button>
        <InstallNpxUv mini />
      </HStack>
    </NavbarRight>
  )
}
