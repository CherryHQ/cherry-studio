import 'emoji-picker-element'

import { CloseCircleFilled, PlusOutlined } from '@ant-design/icons'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { Box, HStack } from '@renderer/components/Layout'
import VariableList from '@renderer/components/VariableList'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { Assistant, AssistantSettings, Variable } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Button, Input, Popover, Tooltip, Typography } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
  onOk: () => void
}

const AssistantPromptSettings: React.FC<Props> = ({ assistant, updateAssistant, onOk }) => {
  const [emoji, setEmoji] = useState(getLeadingEmoji(assistant.name) || assistant.emoji)
  const [name, setName] = useState(assistant.name.replace(getLeadingEmoji(assistant.name) || '', '').trim())
  const [prompt, setPrompt] = useState(assistant.prompt)
  const [tokenCount, setTokenCount] = useState(0)
  const [variables, setVariables] = useState<Variable[]>(assistant.promptVariables || [])
  const [variableName, setVariableName] = useState('')
  const [variableValue, setVariableValue] = useState('')
  const { t } = useTranslation()

  useEffect(() => {
    const updateTokenCount = async () => {
      const count = await estimateTextTokens(prompt)
      setTokenCount(count)
    }
    updateTokenCount()
  }, [prompt])

  const onUpdate = () => {
    const _assistant = {
      ...assistant,
      name: name.trim(),
      emoji,
      prompt,
      promptVariables: variables
    }
    updateAssistant(_assistant)
  }

  const handleEmojiSelect = (selectedEmoji: string) => {
    setEmoji(selectedEmoji)
    const _assistant = {
      ...assistant,
      name: name.trim(),
      emoji: selectedEmoji,
      prompt,
      promptVariables: variables
    }
    updateAssistant(_assistant)
  }

  const handleEmojiDelete = () => {
    setEmoji('')
    const _assistant = {
      ...assistant,
      name: name.trim(),
      prompt,
      emoji: '',
      promptVariables: variables
    }
    updateAssistant(_assistant)
  }

  const handleUpdateVariables = (updatedVariables: Variable[]) => {
    const _assistant = {
      ...assistant,
      name: name.trim(),
      emoji,
      prompt,
      promptVariables: updatedVariables
    }
    updateAssistant(_assistant)
  }

  const handleInsertVariable = (varName: string) => {
    const insertText = `{{${varName}}}`
    setPrompt((prev) => prev + insertText)
  }

  const addVariable = () => {
    if (!variableName.trim()) return

    const newVar: Variable = {
      id: uuidv4(),
      name: variableName.trim(),
      value: variableValue.trim()
    }

    const updatedVariables = [...variables, newVar]
    setVariables(updatedVariables)
    setVariableName('')
    setVariableValue('')

    const _assistant = {
      ...assistant,
      name: name.trim(),
      emoji,
      prompt,
      promptVariables: updatedVariables
    }
    updateAssistant(_assistant)
  }

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack gap={8} alignItems="center">
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
      <TextAreaContainer>
        <TextArea
          rows={10}
          placeholder={t('common.assistant') + t('common.prompt')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={onUpdate}
          spellCheck={false}
          style={{ minHeight: 'calc(80vh - 320px)', maxHeight: 'calc(80vh - 270px)' }}
        />
        <TokenCount>Tokens: {tokenCount}</TokenCount>
      </TextAreaContainer>

      <Box mt={12} mb={8}>
        <HStack justifyContent="space-between" alignItems="center">
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t('common.variables')}
          </Typography.Title>
          <Tooltip title={t('common.variables_help')}>
            <Typography.Text type="secondary" style={{ fontSize: '12px', cursor: 'help' }}>
              ?
            </Typography.Text>
          </Tooltip>
        </HStack>
      </Box>

      <VariableList
        variables={variables}
        setVariables={setVariables}
        onUpdate={handleUpdateVariables}
        onInsertVariable={handleInsertVariable}
      />

      <HStack gap={8} width="100%" mt={8} mb={8}>
        <Input
          placeholder={t('common.variable_name')}
          value={variableName}
          onChange={(e) => setVariableName(e.target.value)}
          style={{ width: '30%' }}
        />
        <Input
          placeholder={t('common.value')}
          value={variableValue}
          onChange={(e) => setVariableValue(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={addVariable}>
          {t('common.add')}
        </Button>
      </HStack>

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
  position: absolute;
  bottom: 8px;
  right: 8px;
  background-color: var(--color-background-soft);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text-2);
  user-select: none;
`

export default AssistantPromptSettings
