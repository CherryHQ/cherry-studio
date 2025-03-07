import 'emoji-picker-element'

import { CloseCircleFilled, LoadingOutlined, ReloadOutlined } from '@ant-design/icons'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { Box, HStack } from '@renderer/components/Layout'
import { fetchEmojiSuggestion } from '@renderer/services/ApiService'
import { Assistant, AssistantSettings } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { ensureValidAssistant } from '@renderer/utils/safeAssistantUtils'
import { Button, Input, Popover, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
  onOk: () => void
}

const AssistantPromptSettings: React.FC<Props> = ({ assistant, updateAssistant, onOk }) => {
  const safeAssistant = ensureValidAssistant(assistant)
  const [emoji, setEmoji] = useState(getLeadingEmoji(safeAssistant.name) || safeAssistant.emoji || '')
  const [name, setName] = useState(safeAssistant.name.replace(getLeadingEmoji(safeAssistant.name) || '', '').trim())
  const [prompt, setPrompt] = useState(safeAssistant.prompt)
  const [emojiLoading, setEmojiLoading] = useState(false)
  const { t } = useTranslation()

  const onUpdate = () => {
    const _assistant = { ...safeAssistant, name: name.trim(), emoji, prompt }
    updateAssistant(_assistant)
  }

  const handleEmojiSelect = (selectedEmoji: string) => {
    setEmoji(selectedEmoji)
    const _assistant = { ...safeAssistant, name: name.trim(), emoji: selectedEmoji, prompt }
    updateAssistant(_assistant)
  }

  const handleEmojiDelete = () => {
    setEmoji('')
    const _assistant = { ...safeAssistant, name: name.trim(), prompt, emoji: '' }
    updateAssistant(_assistant)
  }

  // 自动生成emoji的函数
  const generateEmoji = async (promptText: string) => {
    if (!promptText) return
    setEmojiLoading(true)
    try {
      const generatedEmoji = await fetchEmojiSuggestion(promptText)
      // 确保只使用第一个emoji字符
      if (generatedEmoji) {
        const firstCodePoint = [...generatedEmoji][0] // 正确处理emoji字符
        setEmoji(firstCodePoint)
        // 更新智能体
        const _assistant = { ...safeAssistant, name: name.trim(), emoji: firstCodePoint, prompt }
        updateAssistant(_assistant)
      }
    } catch (error) {
      console.error('Error generating emoji:', error)
    } finally {
      setEmojiLoading(false)
    }
  }

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack $ga$p={8} $alignItems="center">
        <Popover content={<EmojiPicker onEmojiClick={handleEmojiSelect} />} arrow>
          <EmojiButtonWrapper>
            <Button style={{ fontSize: 20, padding: '4px', minWidth: '32px', height: '32px' }}>{emoji}</Button>
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
        <Tooltip title="根据智能体名称生成emoji">
          <Button
            icon={emojiLoading ? <LoadingOutlined /> : <ReloadOutlined />}
            onClick={() => {
              // 优先使用提示词，如果没有则使用名称
              generateEmoji(prompt || name)
            }}
            disabled={emojiLoading}
            style={{ height: '32px' }}
          />
        </Tooltip>
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onUpdate}
          style={{ flex: 1 }}
        />
      </HStack>
      <Box mt={8} mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.prompt')}
      </Box>
      <TextArea
        rows={10}
        placeholder={t('common.assistant') + t('common.prompt')}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={onUpdate}
        spellCheck={false}
        style={{ minHeight: 'calc(80vh - 200px)', maxHeight: 'calc(80vh - 150px)' }}
      />
      <HStack width="100%" $justifyContent="flex-end" mt="10px">
        <Button type="primary" onClick={onOk}>
          {t('common.close')}
        </Button>
      </HStack>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  padding: 5px;
`

const EmojiButtonWrapper = styled.div`
  position: relative;
  display: inline-block;

  &:hover .delete-icon {
    display: block !important;
  }
`

export default AssistantPromptSettings
