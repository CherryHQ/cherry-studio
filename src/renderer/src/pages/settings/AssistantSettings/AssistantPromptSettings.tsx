import 'emoji-picker-element'

import { CloseCircleFilled } from '@ant-design/icons'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { Box, HSpaceBetweenStack, HStack } from '@renderer/components/Layout'
import RichEditor from '@renderer/components/RichEditor'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { Assistant, AssistantSettings } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Button, Input, Popover } from 'antd'
import { throttle } from 'lodash'
import { Edit, HelpCircle, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDivider } from '..'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings?: (settings: AssistantSettings) => void
  onOk?: () => void
}

const AssistantPromptSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const [emoji, setEmoji] = useState(getLeadingEmoji(assistant.name) || assistant.emoji)
  const [name, setName] = useState(assistant.name.replace(getLeadingEmoji(assistant.name) || '', '').trim())
  const [prompt, setPrompt] = useState(assistant.prompt)
  const [tokenCount, setTokenCount] = useState(0)
  const { t } = useTranslation()
  const [showPreview, setShowPreview] = useState(prompt.length > 0)
  const editorRef = useRef<RichEditorRef>(null)

  useEffect(() => {
    const updateTokenCount = async () => {
      // 对于 Markdown 内容，先转换为纯文本再计算 token
      const textContent = editorRef.current?.getContent() || prompt
      const count = await estimateTextTokens(textContent)
      setTokenCount(count)
    }
    updateTokenCount()
  }, [prompt])

  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: assistant.model?.name
  })

  const onUpdate = useMemo(
    () =>
      throttle(() => {
        const _assistant = { ...assistant, name: name.trim(), emoji, prompt }
        updateAssistant(_assistant)
        window.message.success(t('common.saved'))
      }, 500),
    [assistant, name, emoji, prompt, updateAssistant, t]
  )

  const handleEmojiSelect = (selectedEmoji: string) => {
    setEmoji(selectedEmoji)
    const _assistant = { ...assistant, name: name.trim(), emoji: selectedEmoji, prompt }
    updateAssistant(_assistant)
  }

  const handleEmojiDelete = () => {
    setEmoji('')
    const _assistant = { ...assistant, name: name.trim(), prompt, emoji: '' }
    updateAssistant(_assistant)
  }

  const promptVarsContent = <pre>{t('agents.add.prompt.variables.tip.content')}</pre>

  const handleCommandsReady = (commandAPI: Pick<RichEditorRef, 'unregisterCommand'>) => {
    const disabledCommands = ['image', 'inlineMath']
    disabledCommands.forEach((commandId) => {
      commandAPI.unregisterCommand(commandId)
    })
  }

  const handleMarkdownChange = (newMarkdown: string) => {
    setPrompt(newMarkdown)
  }

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack gap={8} alignItems="center">
        <Popover content={<EmojiPicker onEmojiClick={handleEmojiSelect} />} arrow trigger="click">
          <EmojiButtonWrapper>
            <Button
              style={{
                fontSize: 18,
                padding: '4px',
                minWidth: '28px',
                height: '28px'
              }}>
              {emoji}
            </Button>
            {emoji && (
              <CloseCircleFilled
                className="delete-icon"
                onClick={(e) => {
                  e.stopPropagation()
                  handleEmojiDelete()
                }}
                style={{
                  display: 'none',
                  position: 'absolute',
                  top: '-8px',
                  right: '-8px',
                  fontSize: '16px',
                  color: '#ff4d4f',
                  cursor: 'pointer'
                }}
              />
            )}
          </EmojiButtonWrapper>
        </Popover>
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onUpdate}
          style={{ flex: 1 }}
        />
      </HStack>
      <SettingDivider />
      <HStack mb={8} alignItems="center" gap={4}>
        <Box style={{ fontWeight: 'bold' }}>{t('common.prompt')}</Box>
        <Popover title={t('agents.add.prompt.variables.tip.title')} content={promptVarsContent}>
          <HelpCircle size={14} color="var(--color-text-2)" />
        </Popover>
      </HStack>
      <TextAreaContainer>
        <RichEditorContainer>
          <RichEditor
            key={showPreview ? 'preview' : 'edit'}
            ref={editorRef}
            initialContent={processedPrompt || prompt}
            onMarkdownChange={handleMarkdownChange}
            onCommandsReady={handleCommandsReady}
            showToolbar={!showPreview}
            editable={!showPreview}
            className="prompt-rich-editor"
          />
        </RichEditorContainer>
      </TextAreaContainer>
      <HSpaceBetweenStack width="100%" justifyContent="flex-end" mt="10px">
        <TokenCount>Tokens: {tokenCount}</TokenCount>
        <Button
          type="primary"
          icon={showPreview ? <Edit size={14} /> : <Save size={14} />}
          onClick={() => {
            const currentScrollTop = editorRef.current?.getScrollTop?.() || 0
            if (showPreview) {
              setShowPreview(false)
              requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
            } else {
              onUpdate()
              setShowPreview(true)
              requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
            }
          }}>
          {showPreview ? t('common.edit') : t('common.save')}
        </Button>
      </HSpaceBetweenStack>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

const EmojiButtonWrapper = styled.div`
  position: relative;
  display: inline-block;

  &:hover .delete-icon {
    display: block !important;
  }
`

const TextAreaContainer = styled.div`
  position: relative;
  width: 100%;
`

const TokenCount = styled.div`
  padding: 2px 2px;
  border-radius: 4px;
  font-size: 14px;
  color: var(--color-text-2);
  user-select: none;
`

const RichEditorContainer = styled.div`
  height: calc(80vh - 202px);
  border: 0.5px solid var(--color-border);
  border-radius: 5px;
  overflow: hidden;

  .prompt-rich-editor {
    border: none;
    height: 100%;

    .rich-editor-wrapper {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .rich-editor-content {
      flex: 1;
      overflow: auto;
    }
  }
`

export default AssistantPromptSettings
