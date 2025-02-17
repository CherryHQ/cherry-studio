import { QuestionCircleOutlined } from '@ant-design/icons'
import { REFERENCE_PROMPT } from '@renderer/config/prompts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState } from '@renderer/store'
import { setKnowledgeBasePrompt } from '@renderer/store/settings'
import { Button, Input, message, Space, Tooltip } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const KnowledgeBasePromptSetting: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const { theme: themeMode } = useTheme()
  const storeKnowledgeBasePrompt = useSelector((state: RootState) => state.settings.knowledgeBasePrompt)
  const [localPrompt, setLocalPrompt] = useState(storeKnowledgeBasePrompt)
  const textAreaRef = useRef<TextAreaRef>(null)

  const handlePromptChange = (value: string) => {
    setLocalPrompt(value)
  }

  const handleReset = () => {
    setLocalPrompt(REFERENCE_PROMPT)
  }

  const handleSave = () => {
    if (!localPrompt.trim()) {
      message.error(t('settings.knowledge_base.prompt.empty'))
      return
    }

    if (!localPrompt.includes('{question}') || !localPrompt.includes('{references}')) {
      window.modal.confirm({
        title: t('common.warning'),
        content: t('settings.knowledge_base.prompt.missing_variables'),
        centered: true,
        onOk: () => {
          dispatch(setKnowledgeBasePrompt(localPrompt))
          message.success(t('common.save_success'))
        }
      })
      return
    }

    dispatch(setKnowledgeBasePrompt(localPrompt))
    message.success(t('common.save_success'))
  }

  const handleInsertVariable = (variable: string) => {
    const textarea = textAreaRef.current?.resizableTextArea?.textArea
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value
    const before = text.substring(0, start)
    const after = text.substring(end)
    const newText = `${before}{${variable}}${after}`

    setLocalPrompt(newText)

    // 恢复光标位置
    setTimeout(() => {
      textarea.focus()
      const newPosition = start + variable.length + 2 // 加 2 是因为 {} 两个字符
      textarea.setSelectionRange(newPosition, newPosition)
    }, 0)
  }

  return (
    <SettingGroup theme={themeMode}>
      <SettingTitle>{t('settings.knowledge_base.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            {t('settings.knowledge_base.prompt.title')}
            <Tooltip title={t('settings.knowledge_base.prompt.tooltip')}>
              <QuestionCircleOutlined style={{ fontSize: 14, opacity: 0.6, cursor: 'pointer', marginLeft: 4 }} />
            </Tooltip>
          </div>
          <Input.TextArea
            ref={textAreaRef}
            value={localPrompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            rows={10}
            style={{ width: '100%', marginBottom: 8 }}
            placeholder={t('settings.knowledge_base.prompt.placeholder')}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space size="small">
              <Button size="small" onClick={() => handleInsertVariable('question')}>
                {t('settings.knowledge_base.prompt.insert_user_input')}
              </Button>
              <Button size="small" onClick={() => handleInsertVariable('references')}>
                {t('settings.knowledge_base.prompt.insert_references')}
              </Button>
            </Space>
            <Space>
              <Button size="small" danger onClick={handleReset}>
                {t('common.reset')}
              </Button>
              <Button size="small" type="primary" onClick={handleSave}>
                {t('common.save')}
              </Button>
            </Space>
          </div>
        </div>
      </SettingRow>
    </SettingGroup>
  )
}

export default class KnowledgeBaseSetting {
  static Page: React.FC = () => {
    const { theme: themeMode } = useTheme()

    return (
      <SettingContainer theme={themeMode}>
        <KnowledgeBasePromptSetting />
      </SettingContainer>
    )
  }
}
