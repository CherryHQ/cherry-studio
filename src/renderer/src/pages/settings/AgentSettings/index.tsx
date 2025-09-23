import { Alert, Spinner } from '@heroui/react'
import { TopView } from '@renderer/components/TopView'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { Menu, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AgentEssentialSettings from './AgentEssentialSettings'
import AgentMCPSettings from './AgentMCPSettings'
import AgentPromptSettings from './AgentPromptSettings'
import { AgentLabel } from './shared'

interface AgentSettingPopupShowParams {
  agentId: string
  tab?: AgentSettingPopupTab
}

interface AgentSettingPopupParams extends AgentSettingPopupShowParams {
  resolve: () => void
}

type AgentSettingPopupTab = 'essential' | 'prompt' | 'mcps' | 'session-mcps'

const AgentSettingPopupContainer: React.FC<AgentSettingPopupParams> = ({ tab, agentId, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState<AgentSettingPopupTab>(tab || 'essential')

  const { agent, isLoading, error } = useAgent(agentId)
  const updateAgent = useUpdateAgent()

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
        key: 'mcps',
        label: t('agent.settings.mcps', 'MCP Servers')
      }
    ] as const satisfies { key: AgentSettingPopupTab; label: string }[]
  ).filter(Boolean)

  const ModalContent = () => {
    if (isLoading) {
      // TODO: use skeleton for better ux
      return <Spinner />
    }
    if (error) {
      return (
        <div>
          <Alert color="danger" title={t('agent.get.error.failed')} />
        </div>
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
          {menu === 'essential' && <AgentEssentialSettings agent={agent} update={updateAgent} />}
          {menu === 'prompt' && <AgentPromptSettings agent={agent} update={updateAgent} />}
          {menu === 'mcps' && <AgentMCPSettings agent={agent} updateAgent={updateAgent} />}
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
      title={
        <AgentLabel
          type={agent?.type ?? 'claude-code'}
          name={agent?.name}
          classNames={{ name: 'text-lg font-extrabold' }}
          avatarProps={{ size: 'sm' }}
        />
      }
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

const LeftMenu = styled.div`
  height: 100%;
  border-right: 0.5px solid var(--color-border);
`

const Settings = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 16px 16px;
`

const StyledModal = styled(Modal)`
  .ant-modal-title {
    font-size: 14px;
  }
  .ant-modal-close {
    top: 4px;
    right: 4px;
  }
  .ant-menu-item {
    height: 36px;
    color: var(--color-text-2);
    display: flex;
    align-items: center;
    border: 0.5px solid transparent;
    border-radius: 6px;
    .ant-menu-title-content {
      line-height: 36px;
    }
  }
  .ant-menu-item-active {
    background-color: var(--color-background-soft) !important;
    transition: none;
  }
  .ant-menu-item-selected {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    .ant-menu-title-content {
      color: var(--color-text-1);
      font-weight: 500;
    }
  }
`

const StyledMenu = styled(Menu)`
  width: 220px;
  padding: 5px;
  background: transparent;
  margin-top: 2px;
  .ant-menu-item {
    margin-bottom: 7px;
  }
`

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
