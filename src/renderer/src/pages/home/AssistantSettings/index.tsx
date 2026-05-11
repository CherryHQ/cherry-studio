import { RowFlex } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import type { Assistant } from '@renderer/types'
import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { Menu, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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

  const assistant: Assistant = _useAssistant.assistant ?? props.assistant

  const updateAssistant: (patch: UpdateAssistantDto) => void = (patch) => void _useAssistant.updateAssistant(patch)
  const updateAssistantSettings = _useAssistant.updateAssistantSettings

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
    <Modal
      className="[&_.ant-menu-item-active]:!bg-(--color-background-soft) [&_.ant-menu-item-active]:!transition-none [&_.ant-menu-item-selected]:border-(--color-border) [&_.ant-menu-item-selected]:bg-(--color-background-soft) [&_.ant-menu-item-selected_.ant-menu-title-content]:font-medium [&_.ant-menu-item-selected_.ant-menu-title-content]:text-(--color-text-1) [&_.ant-menu-item]:flex [&_.ant-menu-item]:h-9 [&_.ant-menu-item]:items-center [&_.ant-menu-item]:rounded-md [&_.ant-menu-item]:border-[0.5px] [&_.ant-menu-item]:border-transparent [&_.ant-menu-item]:text-(--color-text-2) [&_.ant-menu-title-content]:leading-9 [&_.ant-modal-close]:top-1 [&_.ant-modal-close]:right-1 [&_.ant-modal-title]:text-sm"
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
        <div className="h-[calc(80vh-20px)] border-(--color-border) border-r-[0.5px]">
          <Menu
            className="mt-0.5 w-[220px] bg-transparent p-[5px] [&_.ant-menu-item]:mb-[7px]"
            defaultSelectedKeys={[tab || 'model']}
            mode="vertical"
            items={items}
            onSelect={({ key }) => setMenu(key as AssistantSettingPopupTab)}
          />
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
