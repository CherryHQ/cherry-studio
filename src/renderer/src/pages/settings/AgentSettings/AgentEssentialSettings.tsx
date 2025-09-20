import CodeEditor from '@renderer/components/CodeEditor'
import { Box, HSpaceBetweenStack, HStack } from '@renderer/components/Layout'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { AgentEntity, UpdateAgentForm } from '@renderer/types'
import { Button, Input, Popover } from 'antd'
import { Edit, HelpCircle, Save } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import styled from 'styled-components'

import { SettingDivider } from '..'

interface AgentEssentialSettingsProps {
  agent: AgentEntity | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string>((agent?.name ?? '').trim())
  const [instructions, setInstructions] = useState<string>(agent?.instructions ?? '')
  const [showPreview, setShowPreview] = useState<boolean>(!!agent?.instructions?.length)
  const [tokenCount, setTokenCount] = useState(0)

  useEffect(() => {
    const updateTokenCount = async () => {
      const count = estimateTextTokens(instructions)
      setTokenCount(count)
    }
    updateTokenCount()
  }, [instructions])

  const editorRef = useRef<RichEditorRef>(null)

  const processedPrompt = usePromptProcessor({
    prompt: instructions,
    modelName: agent?.model
  })

  const onUpdate = () => {
    if (!agent) return
    const _agent = { ...agent, type: undefined, name: name.trim(), instructions } satisfies UpdateAgentForm
    update(_agent)
  }

  const promptVarsContent = <pre>{t('agents.add.prompt.variables.tip.content')}</pre>

  if (!agent) return null

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack gap={8} alignItems="center">
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
          {showPreview ? (
            <MarkdownContainer
              onDoubleClick={() => {
                const currentScrollTop = editorRef.current?.getScrollTop?.() || 0
                setShowPreview(false)
                requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
              }}>
              <ReactMarkdown>{processedPrompt || instructions}</ReactMarkdown>
            </MarkdownContainer>
          ) : (
            <CodeEditor
              value={instructions}
              language="markdown"
              onChange={setInstructions}
              height="100%"
              expanded={false}
              style={{
                height: '100%'
              }}
            />
          )}
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
              requestAnimationFrame(() => {
                setShowPreview(true)
                requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
              })
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

const MarkdownContainer = styled.div.attrs({ className: 'markdown' })`
  height: 100%;
  padding: 0.5em;
  overflow: auto;
`

export default AgentEssentialSettings
