import { Center } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { Alert, Spin } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AdvancedSettings from './AdvancedSettings'
import EssentialSettings from './EssentialSettings'
import PromptSettings from './PromptSettings'
import { LeftMenu, SessionLabel, Settings, StyledMenu, StyledModal } from './shared'
import ToolingSettings from './ToolingSettings'

interface SessionSettingPopupShowParams {
  agentId: string
  sessionId: string
  tab?: AgentSettingPopupTab
}

interface SessionSettingPopupParams extends SessionSettingPopupShowParams {
  resolve: () => void
}

type AgentSettingPopupTab = 'essential' | 'prompt' | 'tooling' | 'advanced' | 'session-mcps'

const SessionSettingPopupContainer: React.FC<SessionSettingPopupParams> = ({ tab, agentId, sessionId, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState<AgentSettingPopupTab>(tab || 'essential')

  const { session, isLoading, error } = useSession(agentId, sessionId)

  const { updateSession } = useUpdateSession(agentId)

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const afterClose = () => {
    resolve()
  }

  const items = (
    [
      {
        key: 'essential',
        label: t('agent.settings.essential')
      },
      {
        key: 'prompt',
        label: t('agent.settings.prompt')
      },
      {
        key: 'tooling',
        label: t('agent.settings.tooling.tab', 'Tooling & permissions')
      },
      {
        key: 'advanced',
        label: t('agent.settings.advance.title', 'Advanced Settings')
      }
    ] as const satisfies { key: AgentSettingPopupTab; label: string }[]
  ).filter(Boolean)

  const ModalContent = () => {
    if (isLoading) {
      // TODO: use skeleton for better ux
      return (
        <Center>
          <Spin />
        </Center>
      )
    }

    if (error) {
      return (
        <Center>
          <Alert type="error" message={t('agent.get.error.failed')} />
        </Center>
      )
    }

    return (
      <div className="flex w-full flex-1">
        <LeftMenu>
          <StyledMenu
            defaultSelectedKeys={[tab || 'essential'] satisfies AgentSettingPopupTab[]}
            mode="vertical"
            selectedKeys={[menu]}
            items={items}
            onSelect={({ key }) => setMenu(key as AgentSettingPopupTab)}
          />
        </LeftMenu>
        <Settings>
          {menu === 'essential' && <EssentialSettings agentBase={session} update={updateSession} />}
          {menu === 'prompt' && <PromptSettings agentBase={session} update={updateSession} />}
          {menu === 'tooling' && <ToolingSettings agentBase={session} update={updateSession} />}
          {menu === 'advanced' && <AdvancedSettings agentBase={session} update={updateSession} />}
        </Settings>
      </div>
    )
  }

  return (
    <StyledModal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={afterClose}
      maskClosable={false}
      footer={null}
      title={<SessionLabel session={session} />}
      transitionName="animation-move-down"
      styles={{
        content: {
          padding: 0,
          overflow: 'hidden',
          height: '80vh',
          display: 'flex',
          flexDirection: 'column'
        },
        header: { padding: '10px 15px', borderBottom: '0.5px solid var(--color-border)', margin: 0, borderRadius: 0 },
        body: {
          padding: 0,
          display: 'flex',
          flex: 1
        }
      }}
      width="min(800px, 70vw)"
      centered>
      <ModalContent />
    </StyledModal>
  )
}

export default class SessionSettingsPopup {
  static show(props: SessionSettingPopupShowParams) {
    return new Promise<void>((resolve) => {
      TopView.show(
        <SessionSettingPopupContainer
          {...props}
          resolve={() => {
            resolve()
            TopView.hide('SessionSettingsPopup')
          }}
        />,
        'SessionSettingsPopup'
      )
    })
  }
}
