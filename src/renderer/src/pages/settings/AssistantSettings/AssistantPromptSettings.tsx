import { Box, HStack } from '@renderer/components/Layout'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Button, Input } from 'antd'
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
  const [name, setName] = useState(assistant.name)
  const [prompt, setPrompt] = useState(assistant.prompt)
  const [pluginId, setPluginId] = useState(assistant.pluginId || '')
  const { t } = useTranslation()

  const onUpdate = () => {
    const _assistant = { ...assistant, name, prompt, pluginId }
    updateAssistant(_assistant)
  }

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <Input
        placeholder={t('common.assistant') + t('common.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={onUpdate}
      />
      <Box mt={8} mb={8} style={{ fontWeight: 'bold' }}>
        {assistant.subType === 'plugin' ? t('common.pluginId') : t('common.prompt')}
      </Box>
      {assistant.subType === 'plugin' ? (
        <Input
          placeholder={t('common.assistant') + t('common.pluginId')}
          value={pluginId}
          onChange={(e) => setPluginId(e.target.value)}
          onBlur={onUpdate}
        />
      ) : (
        <TextArea
          rows={10}
          placeholder={t('common.assistant') + t('common.prompt')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={onUpdate}
          style={{ minHeight: 'calc(80vh - 200px)', maxHeight: 'calc(80vh - 150px)' }}
        />
      )}
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
