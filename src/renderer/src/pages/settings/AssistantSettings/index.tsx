import { HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { useAgent } from '@renderer/hooks/useAgents'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant } from '@renderer/types'
import { Menu, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantKnowledgeBaseSettings from './AssistantKnowledgeBaseSettings'
import AssistantMessagesSettings from './AssistantMessagesSettings'
import AssistantModelSettings from './AssistantModelSettings'
import AssistantPromptSettings from './AssistantPromptSettings'

interface AssistantSettingPopupShowParams {
  assistant: Assistant
}

interface Props extends AssistantSettingPopupShowParams {
  resolve: (assistant: Assistant) => void
}

const AssistantSettingPopupContainer: React.FC<Props> = ({ resolve, ...props }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState('prompt')

  const _useAssistant = useAssistant(props.assistant.id)
  const _useAgent = useAgent(props.assistant.id)
  const isAgent = props.assistant.type === 'agent'

  const assistant = isAgent ? _useAgent.agent : _useAssistant.assistant
  const updateAssistant = isAgent ? _useAgent.updateAgent : _useAssistant.updateAssistant
  const updateAssistantSettings = isAgent ? _useAgent.updateAgentSettings : _useAssistant.updateAssistantSettings

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const afterClose = () => {
    resolve(assistant)
  }

  const items = [
    {
      key: 'prompt',
      label: t('assistants.settings.prompt')
    },
    {
      key: 'model',
      label: t('assistants.settings.model')
    },
    {
      key: 'messages',
      label: t('assistants.settings.preset_messages')
    },
    {
      key: 'knowledge_base',
      label: t('assistants.settings.knowledge_base')
    }
  ]

  return (
    <StyledModal
      open={open}
      onOk={onOk}
      onClose={onCancel}
      onCancel={onCancel}
      afterClose={afterClose}
      footer={null}
      title={assistant.name}
      transitionName="ant-move-down"
      styles={{
        content: {
          padding: 0,
          overflow: 'hidden',
          background: 'var(--color-background)',
          border: `1px solid var(--color-frame-border)`
        },
        header: { padding: '10px 15px', borderBottom: '0.5px solid var(--color-border)', margin: 0 }
      }}
      width="70vw"
      height="80vh"
      centered>
      <HStack>
        <LeftMenu>
          <Menu
            style={{ width: 220, padding: 5, background: 'transparent' }}
            defaultSelectedKeys={['prompt']}
            mode="vertical"
            items={items}
            onSelect={({ key }) => setMenu(key as string)}
          />
        </LeftMenu>
        <Settings>
          {menu === 'prompt' && (
            <AssistantPromptSettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
              onOk={onOk}
            />
          )}
          {menu === 'model' && (
            <AssistantModelSettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
            />
          )}
          {menu === 'messages' && (
            <AssistantMessagesSettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
            />
          )}
          {menu === 'knowledge_base' && (
            <AssistantKnowledgeBaseSettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
            />
          )}
        </Settings>
      </HStack>
    </StyledModal>
  )
}

const LeftMenu = styled.div`
  background-color: var(--color-background);
  height: calc(80vh - 20px);
  border-right: 0.5px solid var(--color-border);
`

const Settings = styled.div`
  flex: 1;
  padding: 10px 20px;
  height: calc(80vh - 20px);
  overflow-y: scroll;
`

const StyledModal = styled(Modal)`
  .ant-modal-title {
    font-size: 14px;
  }
  .ant-modal-close {
    top: 4px;
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

export default class AssistantSettingsPopup {
  static show(props: AssistantSettingPopupShowParams) {
    return new Promise<Assistant>((resolve) => {
      TopView.show(
        <AssistantSettingPopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide('AssistantSettingsPopup')
          }}
        />,
        'AssistantSettingsPopup'
      )
    })
  }
}
