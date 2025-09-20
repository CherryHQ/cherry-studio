import { Avatar } from '@heroui/react'
import { HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { getAgentAvatar } from '@renderer/config/agent'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { Menu, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AgentEssentialSettings from './AgentEssentialSettings'

interface AgentSettingPopupShowParams {
  agentId: string
  tab?: AgentSettingPopupTab
}

interface AgentSettingPopupParams extends AgentSettingPopupShowParams {
  resolve: () => void
}

type AgentSettingPopupTab = 'essential' | 'prompt'

const AgentSettingPopupContainer: React.FC<AgentSettingPopupParams> = ({ tab, agentId, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState<AgentSettingPopupTab>(tab || 'essential')

  const { agent } = useAgent(agentId)
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
      }
    ] satisfies { key: AgentSettingPopupTab; label: string }[]
  ).filter(Boolean) as { key: string; label: string }[]

  return (
    <StyledModal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={afterClose}
      maskClosable={false}
      footer={null}
      title={
        <div className="flex items-center">
          <Avatar size="sm" className="mr-2 h-5 w-5" src={agent ? getAgentAvatar(agent.type) : undefined} />
          <span className="font-extrabold text-xl">{agent?.name ?? ''}</span>
        </div>
      }
      transitionName="animation-move-down"
      styles={{
        content: {
          padding: 0,
          overflow: 'hidden'
        },
        header: { padding: '10px 15px', borderBottom: '0.5px solid var(--color-border)', margin: 0, borderRadius: 0 },
        body: {
          padding: 0
        }
      }}
      width="min(800px, 70vw)"
      height="80vh"
      centered>
      <HStack>
        <LeftMenu>
          <StyledMenu
            defaultSelectedKeys={[tab || 'essential'] satisfies AgentSettingPopupTab[]}
            mode="vertical"
            items={items}
            onSelect={({ key }) => setMenu(key as AgentSettingPopupTab)}
          />
        </LeftMenu>
        <Settings>{menu === 'essential' && <AgentEssentialSettings agent={agent} update={updateAgent} />}</Settings>
      </HStack>
    </StyledModal>
  )
}

const LeftMenu = styled.div`
  height: calc(80vh - 20px);
  border-right: 0.5px solid var(--color-border);
`

const Settings = styled.div`
  flex: 1;
  padding: 16px 16px;
  height: calc(80vh - 16px);
  overflow-y: scroll;
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
