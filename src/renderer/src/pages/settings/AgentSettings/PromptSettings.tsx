import CodeEditor from '@renderer/components/CodeEditor'
import { HSpaceBetweenStack } from '@renderer/components/Layout'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import type { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import type { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { AgentEntity, AgentSessionEntity, UpdateAgentBaseForm } from '@renderer/types'
import { Button, Popover } from 'antd'
import { Edit, HelpCircle, Save } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import styled from 'styled-components'

import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

type AgentPromptSettingsProps =
  | {
      agentBase: AgentEntity | undefined | null
      update: ReturnType<typeof useUpdateAgent>['updateAgent']
    }
  | {
      agentBase: AgentSessionEntity | undefined | null
      update: ReturnType<typeof useUpdateSession>['updateSession']
    }

const PromptSettings: FC<AgentPromptSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [instructions, setInstructions] = useState<string>(agentBase?.instructions ?? '')
  const [showPreview, setShowPreview] = useState<boolean>(!!agentBase?.instructions?.length)
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
    modelName: agentBase?.model
  })

  const updatePrompt = () => {
    if (!agentBase) return
    update({ id: agentBase.id, instructions } satisfies UpdateAgentBaseForm)
  }

  const promptVarsContent = <pre>{t('assistants.presets.add.prompt.variables.tip.content')}</pre>

  if (!agentBase) return null

  return (
    <SettingsContainer>
      <SettingsItem divider={false} className="flex-1">
        <SettingsTitle>
          {t('common.prompt')}
          <Popover title={t('assistants.presets.add.prompt.variables.tip.title')} content={promptVarsContent}>
            <HelpCircle size={14} color="var(--color-text-2)" />
          </Popover>
        </SettingsTitle>
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
                updatePrompt()
                requestAnimationFrame(() => {
                  setShowPreview(true)
                  requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
                })
              }
            }}>
            {showPreview ? t('common.edit') : t('common.save')}
          </Button>
        </HSpaceBetweenStack>
      </SettingsItem>
    </SettingsContainer>
  )
}

const TextAreaContainer = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
`

const TokenCount = styled.div`
  padding: 2px 2px;
  border-radius: 4px;
  font-size: 14px;
  color: var(--color-text-2);
  user-select: none;
`

const RichEditorContainer = styled.div`
  height: 100%;
  flex: 1;
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

export default PromptSettings
