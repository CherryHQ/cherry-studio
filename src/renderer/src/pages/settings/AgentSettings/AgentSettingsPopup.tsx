import { Center } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { Alert, Spin } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AdvancedSettings from './AdvancedSettings'
import EssentialSettings from './EssentialSettings'
import PluginSettings from './PluginSettings'
import PromptSettings from './PromptSettings'
import { AgentLabel, LeftMenu, Settings, StyledMenu, StyledModal } from './shared'
import ToolingSettings from './ToolingSettings'

interface AgentSettingPopupShowParams {
  agentId: string
  tab?: AgentSettingPopupTab
}

interface AgentSettingPopupParams extends AgentSettingPopupShowParams {
  resolve: () => void
}

type AgentSettingPopupTab = 'essential' | 'prompt' | 'tooling' | 'advanced' | 'plugins' | 'session-mcps'

const AgentSettingPopupContainer: React.FC<AgentSettingPopupParams> = ({ tab, agentId, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState<AgentSettingPopupTab>(tab || 'essential')

  const { agent, isLoading, error } = useAgent(agentId)
  const { updateAgent } = useUpdateAgent()

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
        key: 'plugins',
        label: t('agent.settings.plugins.tab', 'Plugins')
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
        <Center flex={1}>
          <Spin />
        </Center>
      )
    }

    if (error) {
      return (
        <Center flex={1}>
          <Alert type="error" message={t('agent.get.error.failed')} />
        </Center>
      )
    }

    if (!agent) {
      return null
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
          {menu === 'essential' && <EssentialSettings agentBase={agent} update={updateAgent} />}
          {menu === 'prompt' && <PromptSettings agentBase={agent} update={updateAgent} />}
          {menu === 'tooling' && <ToolingSettings agentBase={agent} update={updateAgent} />}
          {menu === 'plugins' && <PluginSettings agentBase={agent} update={updateAgent} />}
          {menu === 'advanced' && <AdvancedSettings agentBase={agent} update={updateAgent} />}
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
      maskClosable={menu !== 'prompt'}
      footer={null}
      title={<AgentLabel agent={agent} />}
      transitionName="animation-move-down"
      styles={{
        content: {
          padding: 0,
          overflow: 'hidden',
          height: '80vh',
          display: 'flex',
          flexDirection: 'column'
        },
        header: {
          padding: '10px 15px',
          paddingRight: '32px',
          borderBottom: '0.5px solid var(--color-border)',
          margin: 0,
          borderRadius: 0
        },
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

export default class AgentSettingsPopup {
  static show(props: AgentSettingPopupShowParams) {
    return new Promise<void>((resolve) => {
      TopView.show(
        <AgentSettingPopupContainer
          {...props}
          resolve={() => {
            resolve()
            TopView.hide('AgentSettingsPopup')
          }}
        />,
        'AgentSettingsPopup'
      )
    })
  }
}
