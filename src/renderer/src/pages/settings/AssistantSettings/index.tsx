import { HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { useAgent } from '@renderer/hooks/useAgents'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { Assistant } from '@renderer/types'
import { Menu, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantKnowledgeBaseSettings from './AssistantKnowledgeBaseSettings'
import AssistantMCPSettings from './AssistantMCPSettings'
import AssistantMessagesSettings from './AssistantMessagesSettings'
import AssistantModelSettings from './AssistantModelSettings'
import AssistantPromptSettings from './AssistantPromptSettings'

interface AssistantSettingPopupShowParams {
  assistant: Assistant
  tab?: AssistantSettingPopupTab
}

type AssistantSettingPopupTab = 'prompt' | 'model' | 'messages' | 'knowledge_base' | 'mcp'

interface Props extends AssistantSettingPopupShowParams {
  resolve: (assistant: Assistant) => void
}

const AssistantSettingPopupContainer: React.FC<Props> = ({ resolve, tab, ...props }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState<AssistantSettingPopupTab>(tab || 'prompt')

  const _useAssistant = useAssistant(props.assistant.id)
  const _useAgent = useAgent(props.assistant.id)
  const isAgent = props.assistant.type === 'agent'

  const assistant = isAgent ? _useAgent.agent : _useAssistant.assistant
  const updateAssistant = isAgent ? _useAgent.updateAgent : _useAssistant.updateAssistant
  const updateAssistantSettings = isAgent ? _useAgent.updateAgentSettings : _useAssistant.updateAssistantSettings

  const showKnowledgeIcon = useSidebarIconShow('knowledge')

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
    showKnowledgeIcon && {
      key: 'knowledge_base',
      label: t('assistants.settings.knowledge_base')
    },
    {
      key: 'mcp',
      label: t('assistants.settings.mcp')
    }
  ].filter(Boolean) as { key: string; label: string }[]

  return (
    <StyledModal
      open={open}
      onOk={onOk}
      onClose={onCancel}
      onCancel={onCancel}
      afterClose={afterClose}
      footer={null}
      title={assistant.name}
      /*******************************************
       * IMPORTANT: The Comment of transitionName is because:
       *
       * When in the production mode,
       * if some of the antd components(like Select or not showing the assistant tab) not loaded beforehand,
       * the modal will not close properly when using unofficially transitionName(like ant-move-down).
       *
       * The resason may be that the antd CSS-in-JS is not loaded the unofficially ant-xxx-xxx motions,
       * this will cause the modal close process being interrupted.
       * see antd issue for more details: https://github.com/ant-design/ant-design/issues/29626
       *
       * The deeper reason may be that the css/js chunking handle method is different between dev and prod envs
       * If we want to solve the problem completely, we need to refactor the antd someway.
       *
       * The temporary solution is:
       * 1. not set transitionName (transitionName is no longer supported in antd 5+)
       * 2. set timeout to execute the modal resolve()
       * 3. load the other complex antd components(like Select) beforehand
       *
       * we take the first solution for now.
       */
      // transitionName="ant-move-down"
      styles={{
        content: {
          padding: 0,
          overflow: 'hidden',
          background: 'var(--color-background)'
        },
        header: { padding: '10px 15px', borderBottom: '0.5px solid var(--color-border)', margin: 0 }
      }}
      width="70vw"
      height="80vh"
      centered>
      <HStack>
        <LeftMenu>
          <StyledMenu
            defaultSelectedKeys={[tab || 'prompt']}
            mode="vertical"
            items={items}
            onSelect={({ key }) => setMenu(key as AssistantSettingPopupTab)}
          />
        </LeftMenu>
        <Settings>
          {menu === 'prompt' && (
            <AssistantPromptSettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
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
          {menu === 'knowledge_base' && showKnowledgeIcon && (
            <AssistantKnowledgeBaseSettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
            />
          )}
          {menu === 'mcp' && (
            <AssistantMCPSettings
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

const StyledMenu = styled(Menu)`
  width: 220px;
  padding: 5px;
  background: transparent;
  margin-top: 2px;
  .ant-menu-item {
    margin-bottom: 7px;
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
