import 'emoji-picker-element'

import EmojiPicker from '@renderer/components/EmojiPicker'
import { Box, HStack } from '@renderer/components/Layout'
import { Assistant, AssistantSettings } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Button, Input, Popover } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
  onOk: () => void
}

const AssistantPromptSettings: React.FC<Props> = ({ assistant, updateAssistant, onOk }) => {
  const [emoji, setEmoji] = useState(getLeadingEmoji(assistant.name) || '⭐️')
  const [name, setName] = useState(assistant.name.replace(getLeadingEmoji(assistant.name) || '', '').trim())
  const [prompt, setPrompt] = useState(assistant.prompt)
  const { t } = useTranslation()

  const onUpdate = () => {
    const _assistant = { ...assistant, name: `${emoji} ${name}`.trim(), prompt }
    updateAssistant(_assistant)
  }

  const handleEmojiSelect = (selectedEmoji: string) => {
    setEmoji(selectedEmoji)
    const _assistant = { ...assistant, name: `${selectedEmoji} ${name}`.trim(), prompt }
    updateAssistant(_assistant)
  }

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack gap={8} alignItems="center">
        <Popover content={<EmojiPicker onEmojiClick={handleEmojiSelect} />} arrow>
          <Button style={{ fontSize: 20, padding: '4px 8px', minWidth: '42px', height: '32px' }}>{emoji}</Button>
        </Popover>
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
      <HStack width="100%" justifyContent="flex-end" mt="10px">
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

export default AssistantPromptSettings
