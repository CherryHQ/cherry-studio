import { MenuItem, MenuList, RowFlex } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useAssistantPreset } from '@renderer/hooks/useAssistantPresets'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import type { Assistant } from '@renderer/types'
import { Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AssistantKnowledgeBaseSettings from './AssistantKnowledgeBaseSettings'
import AssistantMCPSettings from './AssistantMCPSettings'
import AssistantModelSettings from './AssistantModelSettings'
import AssistantPromptSettings from './AssistantPromptSettings'
import AssistantRegularPromptsSettings from './AssistantRegularPromptsSettings'

interface AssistantSettingPopupShowParams {
  assistant: Assistant
  tab?: AssistantSettingPopupTab
}

type AssistantSettingPopupTab = 'prompt' | 'model' | 'messages' | 'knowledge_base' | 'mcp' | 'regular_phrases'

interface Props extends AssistantSettingPopupShowParams {
  resolve: (assistant: Assistant) => void
}

const AssistantSettingPopupContainer: React.FC<Props> = ({ resolve, tab, ...props }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState<AssistantSettingPopupTab>(tab || 'model')

  const _useAssistant = useAssistant(props.assistant.id)
  const _useAgent = useAssistantPreset(props.assistant.id)
  const isAgent = props.assistant.type === 'agent'

  const assistant = isAgent ? (_useAgent.preset ?? props.assistant) : _useAssistant.assistant
  const updateAssistant = isAgent ? _useAgent.updateAssistantPreset : _useAssistant.updateAssistant
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
    },
    {
      key: 'regular_phrases',
      label: t('assistants.settings.regular_phrases.title', 'Regular Prompts')
    }
  ].filter(Boolean) as { key: string; label: string }[]

  return (
    <Modal
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
      rootClassName="[&_.ant-modal-title]:text-sm [&_.ant-modal-close]:top-1 [&_.ant-modal-close]:right-1"
      width="min(900px, 70vw)"
      height="80vh"
      centered>
      <RowFlex>
        <div className="h-[calc(80vh-20px)] border-border border-r-[0.5px]">
          <MenuList className="mt-0.5 w-[220px] p-1.25">
            {items.map((item) => (
              <MenuItem
                key={item.key}
                label={item.label}
                active={menu === item.key}
                className="mb-1.75 font-medium last:mb-0"
                onClick={() => setMenu(item.key as AssistantSettingPopupTab)}
              />
            ))}
          </MenuList>
        </div>
        <div className="h-[calc(80vh-16px)] flex-1 overflow-y-scroll p-4">
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
          {menu === 'regular_phrases' && (
            <AssistantRegularPromptsSettings assistant={assistant} updateAssistant={updateAssistant} />
          )}
        </div>
      </RowFlex>
    </Modal>
  )
}

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
