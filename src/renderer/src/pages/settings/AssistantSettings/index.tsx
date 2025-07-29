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
import AssistantMemorySettings from './AssistantMemorySettings'
import AssistantModelSettings from './AssistantModelSettings'
import AssistantPromptSettings from './AssistantPromptSettings'
import AssistantRegularPromptsSettings from './AssistantRegularPromptsSettings'

interface AssistantSettingPopupShowParams {
  assistant: Assistant
  tab?: AssistantSettingPopupTab
}

type AssistantSettingPopupTab =
  | 'prompt'
  | 'model'
  | 'messages'
  | 'knowledge_base'
  | 'mcp'
  | 'regular_phrases'
  | 'memory'

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
    showKnowledgeIcon && {
      key: 'knowledge_base',
      label: t('assistants.settings.knowledge_base.label')
    },
    {
      key: 'mcp',
      label: t('assistants.settings.mcp.label')
    },
    {
      key: 'regular_phrases',
      label: t('assistants.settings.regular_phrases.title', 'Regular Prompts')
    },
    {
      key: 'memory',
      label: t('memory.title', 'Memories')
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
          {menu === 'regular_phrases' && (
            <AssistantRegularPromptsSettings assistant={assistant} updateAssistant={updateAssistant} />
          )}
          {menu === 'memory' && (
            <AssistantMemorySettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
              onClose={onCancel}
            />
          )}
        </Settings>
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
