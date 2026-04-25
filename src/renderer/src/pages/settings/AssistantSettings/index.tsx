import { RowFlex } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useAssistantPreset } from '@renderer/hooks/useAssistantPresets'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import type { Assistant, AssistantPreset } from '@renderer/types'
import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { Menu, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantKnowledgeBaseSettings from './AssistantKnowledgeBaseSettings'
import AssistantMCPSettings from './AssistantMCPSettings'
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
  const [menu, setMenu] = useState<AssistantSettingPopupTab>(tab || 'model')

  const _useAssistant = useAssistant(props.assistant.id)
  const _useAgent = useAssistantPreset(props.assistant.id)
  // The popup is opened from two places: a real assistant (DataApi-backed) and
  // a preset card (Redux v1 slice). Treat the entry as a preset if Redux holds
  // a record with this id. Falls back to v1 prop shape when neither lookup
  // resolves yet (transient first-render state).
  const isAgent = !!_useAgent.preset

  const assistant: Assistant = isAgent
    ? ((_useAgent.preset as Assistant | undefined) ?? props.assistant)
    : (_useAssistant.assistant ?? props.assistant)

  // Normalize preset (full-record write) and assistant (partial PATCH) update
  // shapes to the same partial-patch contract that child panels expect.
  const updateAssistant: (patch: UpdateAssistantDto) => void = isAgent
    ? (patch) => _useAgent.updateAssistantPreset({ ...(assistant as AssistantPreset), ...patch })
    : (patch) => void _useAssistant.updateAssistant(patch)
  const updateAssistantSettings = isAgent
    ? _useAgent.updateAssistantPresetSettings
    : _useAssistant.updateAssistantSettings

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
      key: 'model',
      label: t('assistants.settings.model')
    },
    {
      key: 'prompt',
      label: t('assistants.settings.prompt')
    },
    showKnowledgeIcon && {
      key: 'knowledge_base',
      label: t('assistants.settings.knowledge_base.label')
    },
    {
      key: 'mcp',
      label: t('assistants.settings.mcp.label')
    }
  ].filter(Boolean) as { key: string; label: string }[]

  return (
    <StyledModal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={afterClose}
      maskClosable={menu !== 'prompt'}
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
      width="min(900px, 70vw)"
      height="80vh"
      centered>
      <RowFlex>
        <LeftMenu>
          <StyledMenu
            defaultSelectedKeys={[tab || 'model']}
            mode="vertical"
            items={items}
            onSelect={({ key }) => setMenu(key as AssistantSettingPopupTab)}
          />
        </LeftMenu>
        <Settings>
          {menu === 'model' && (
            <AssistantModelSettings
              assistant={assistant}
              updateAssistant={updateAssistant}
              updateAssistantSettings={updateAssistantSettings}
            />
          )}
          {menu === 'prompt' && (
            <AssistantPromptSettings
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
          {menu === 'mcp' && <AssistantMCPSettings assistant={assistant} updateAssistant={updateAssistant} />}
        </Settings>
      </RowFlex>
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
