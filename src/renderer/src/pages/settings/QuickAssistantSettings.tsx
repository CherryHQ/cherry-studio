import { CaretRightOutlined, DeleteOutlined, EditOutlined, InfoCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import {
  CustomPrompt,
  setClickTrayToShowQuickAssistant,
  setCustomPrompts,
  setEnableQuickAssistant
} from '@renderer/store/settings'
import HomeWindow from '@renderer/windows/mini/home/HomeWindow'
import { Button, Form, Input, List, message, Modal, Switch, Tooltip } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const QuickAssistantSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { enableQuickAssistant, clickTrayToShowQuickAssistant, customPrompts, setTray } = useSettings()
  const dispatch = useAppDispatch()
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<CustomPrompt | null>(null)
  const [form] = Form.useForm()
  const [isPromptsExpanded, setIsPromptsExpanded] = useState(false)

  const handleEnableQuickAssistant = async (enable: boolean) => {
    dispatch(setEnableQuickAssistant(enable))
    await window.api.config.set('enableQuickAssistant', enable)
    window.api.restartTray()
    const disable = !enable
    disable && window.api.miniWindow.close()

    if (enable && !clickTrayToShowQuickAssistant) {
      window.message.info({
        content: t('settings.quickAssistant.use_shortcut_to_show'),
        duration: 4,
        icon: <InfoCircleOutlined />,
        key: 'quick-assistant-info'
      })
    }

    if (enable && clickTrayToShowQuickAssistant) {
      setTray(true)
    }
  }

  const handleClickTrayToShowQuickAssistant = async (checked: boolean) => {
    dispatch(setClickTrayToShowQuickAssistant(checked))
    await window.api.config.set('clickTrayToShowQuickAssistant', checked)
    checked && setTray(true)
  }

  const showModal = (prompt?: CustomPrompt) => {
    setEditingPrompt(prompt || null)
    if (prompt) {
      form.setFieldsValue(prompt)
    } else {
      form.resetFields()
    }
    setIsModalVisible(true)
  }

  const handleCancel = () => {
    setIsModalVisible(false)
    setEditingPrompt(null)
  }

  const handleFinish = (values: { name: string; prompt: string }) => {
    const prompts = Array.isArray(customPrompts) ? [...customPrompts] : []
    const currentName = values.name.trim()

    if (editingPrompt) {
      const updatedPrompts = prompts.map((cp) =>
        cp.id === editingPrompt.id ? { ...cp, name: currentName, prompt: values.prompt } : cp
      )
      const isModified = editingPrompt.name !== currentName || editingPrompt.prompt !== values.prompt

      if (isModified) {
        dispatch(setCustomPrompts(updatedPrompts))
        message.success(t('settings.quickAssistant.customPrompts.updated'))
      }
    } else {
      const exists = prompts.some((cp) => cp.name === currentName)
      if (!exists) {
        const newPrompt: CustomPrompt = {
          id: Date.now().toString(),
          name: currentName,
          prompt: values.prompt
        }
        dispatch(setCustomPrompts([...prompts, newPrompt]))
        message.success(t('settings.quickAssistant.customPrompts.added'))
      }
    }
    setIsModalVisible(false)
    form.resetFields()
  }

  const handleDelete = (id: string) => {
    const filteredPrompts = customPrompts.filter((cp) => cp.id !== id)
    dispatch(setCustomPrompts(filteredPrompts))
    message.success(t('settings.quickAssistant.customPrompts.deleted'))
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.quickAssistant.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.quickAssistant.enable_quick_assistant')}</span>
            <Tooltip title={t('settings.quickAssistant.use_shortcut_to_show')} placement="right">
              <InfoCircleOutlined style={{ cursor: 'pointer' }} />
            </Tooltip>
          </SettingRowTitle>
          <Switch checked={enableQuickAssistant} onChange={handleEnableQuickAssistant} />
        </SettingRow>
        {enableQuickAssistant && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.quickAssistant.click_tray_to_show')}</SettingRowTitle>
              <Switch checked={clickTrayToShowQuickAssistant} onChange={handleClickTrayToShowQuickAssistant} />
            </SettingRow>
          </>
        )}
        {enableQuickAssistant && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CaretRightOutlined
                  rotate={isPromptsExpanded ? 90 : 0}
                  style={{ cursor: 'pointer', transition: 'all 0.3s' }}
                  onClick={() => setIsPromptsExpanded(!isPromptsExpanded)}
                />
                <span>{t('settings.quickAssistant.customPrompts.title')}</span>
              </SettingRowTitle>
              <Button type="text" icon={<PlusOutlined />} onClick={() => showModal()} />
            </SettingRow>
            <CollapseContainer expanded={isPromptsExpanded}>
              <SettingDivider />
              <List
                dataSource={customPrompts}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button key="edit" type="text" icon={<EditOutlined />} onClick={() => showModal(item)} />,
                      <Button
                        key="delete"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(item.id)}
                      />
                    ]}>
                    <List.Item.Meta title={item.name} />
                  </List.Item>
                )}
              />
            </CollapseContainer>
            <Modal
              title={
                editingPrompt
                  ? t('settings.quickAssistant.customPrompts.editPrompt')
                  : t('settings.quickAssistant.customPrompts.addPrompt')
              }
              visible={isModalVisible}
              onCancel={handleCancel}
              onOk={() => form.submit()}
              okText={t('common.save')}
              cancelText={t('common.cancel')}>
              <Form form={form} layout="vertical" onFinish={handleFinish}>
                <Form.Item
                  label={t('settings.quickAssistant.customPrompts.functionName')}
                  name="name"
                  rules={[
                    { required: true, message: t('settings.quickAssistant.customPrompts.nameRequired') },
                    () => ({
                      validator(_, value) {
                        const currentValue = (value || '').trim()
                        if (!currentValue) return Promise.resolve()

                        const exists = customPrompts?.some(
                          (cp) => cp.name.trim() === currentValue && cp.id !== editingPrompt?.id
                        )
                        return exists
                          ? Promise.reject(new Error(t('settings.quickAssistant.customPrompts.nameUnique')))
                          : Promise.resolve()
                      }
                    })
                  ]}>
                  <Input placeholder={t('settings.quickAssistant.customPrompts.functionNamePlaceholder')} />
                </Form.Item>
                <Form.Item
                  label={t('settings.quickAssistant.customPrompts.prompt')}
                  name="prompt"
                  rules={[{ required: true, message: t('settings.quickAssistant.customPrompts.promptRequired') }]}>
                  <Input.TextArea rows={4} placeholder={t('settings.quickAssistant.customPrompts.promptPlaceholder')} />
                </Form.Item>
              </Form>
            </Modal>
          </>
        )}
      </SettingGroup>
      {enableQuickAssistant && (
        <AssistantContainer>
          <HomeWindow />
        </AssistantContainer>
      )}
    </SettingContainer>
  )
}

const AssistantContainer = styled.div`
  width: 100%;
  height: 460px;
  background-color: var(--color-background);
  border-radius: 10px;
  border: 0.5px solid var(--color-border);
  margin: 0 auto;
  overflow: hidden;
`

const CollapseContainer = styled.div<{ expanded: boolean }>`
  max-height: ${(props) => (props.expanded ? '500px' : '0')};
  overflow: hidden;
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: ${(props) => (props.expanded ? 1 : 0)};
  visibility: ${(props) => (props.expanded ? 'visible' : 'hidden')};
`

export default QuickAssistantSettings
