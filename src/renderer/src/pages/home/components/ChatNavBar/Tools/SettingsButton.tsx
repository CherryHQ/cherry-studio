import { Tooltip } from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import type { Assistant } from '@renderer/types'
import { Drawer } from 'antd'
import { t } from 'i18next'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'

import NavbarIcon from '../../../../../components/NavbarIcon'
import { AgentSettingsTab, AssistantSettingsTab } from './SettingsTab'

interface Props {
  assistant?: Assistant
}

const SettingsButton: FC<Props> = ({ assistant }) => {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTopicOrSession] = useCache('chat.active_view')

  const isTopicSettings = activeTopicOrSession === 'topic'
  const isAgentSettings = activeTopicOrSession === 'session'

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
        {isTopicSettings && assistant && <AssistantSettingsTab assistant={assistant} />}
        {isAgentSettings && <AgentSettingsTab />}
      </Drawer>
    </>
  )
}

export default SettingsButton
