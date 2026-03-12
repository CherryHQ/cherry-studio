import NavbarIcon from '@renderer/components/NavbarIcon'
import { Drawer, Tooltip } from 'antd'
import { t } from 'i18next'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'

import AgentSettingsTab from '../../../AgentSettingsTab'

const SettingsButton: FC = () => {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <Tooltip title={t('settings.title')} mouseEnterDelay={0.8}>
        <NavbarIcon onClick={() => setSettingsOpen(true)}>
          <Settings2 size={18} />
        </NavbarIcon>
      </Tooltip>
      <Drawer
        placement="right"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width="var(--assistants-width)"
        closable={false}
        styles={{ body: { padding: 0, paddingTop: 'var(--navbar-height)' } }}>
        <AgentSettingsTab />
      </Drawer>
    </>
  )
}

export default SettingsButton
