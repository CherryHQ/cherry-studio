import { Tooltip } from '@cherrystudio/ui'
import type { Assistant } from '@renderer/types'
import { Drawer } from 'antd'
import { t } from 'i18next'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'

import NavbarIcon from '../../../../../components/NavbarIcon'
import { AssistantSettingsTab } from './SettingsTab'

interface Props {
  assistant?: Assistant
}

const SettingsButton: FC<Props> = ({ assistant }) => {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <Tooltip content={t('settings.title')} delay={800}>
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
        {assistant && <AssistantSettingsTab assistant={assistant} />}
      </Drawer>
    </>
  )
}

export default SettingsButton
