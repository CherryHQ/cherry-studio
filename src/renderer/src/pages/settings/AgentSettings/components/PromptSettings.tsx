import { Button, SpaceBetweenRowFlex } from '@cherrystudio/ui'
import CodeEditor from '@renderer/components/CodeEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { UpdateAgentBaseForm } from '@renderer/types'
import { Popover } from 'antd'
import { Edit, HelpCircle, Save } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

const PromptSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [instructions, setInstructions] = useState<string>(agentBase?.instructions ?? '')
  const [showPreview, setShowPreview] = useState<boolean>(!!agentBase?.instructions?.length)
  const [tokenCount, setTokenCount] = useState(0)

  useEffect(() => {
    const updateTokenCount = async () => {
      const count = estimateTextTokens(instructions)
      setTokenCount(count)
    }
    void updateTokenCount()
  }, [instructions])

  const editorRef = useRef<RichEditorRef>(null)

  const processedPrompt = usePromptProcessor({
    prompt: instructions,
    modelName: agentBase?.model
  })

  const updatePrompt = () => {
    if (!agentBase) return
    void update({ id: agentBase.id, instructions } satisfies UpdateAgentBaseForm)
  }

  const promptVarsContent = <pre>{t('assistants.presets.add.prompt.variables.tip.content')}</pre>

  if (!agentBase) return null

  return (
    <SettingsContainer className="flex h-full flex-col overflow-hidden">
      <SettingsItem divider={false} className="flex min-h-0 flex-1 flex-col">
        <SettingsTitle>
          {t('common.prompt')}
          <Popover title={t('assistants.presets.add.prompt.variables.tip.title')} content={promptVarsContent}>
            <HelpCircle size={14} color="var(--color-foreground-secondary)" />
          </Popover>
        </SettingsTitle>
        <div className="relative mt-[5px] min-h-0 w-full flex-1 overflow-hidden">
          <div className="h-full flex-1 overflow-hidden rounded-[5px] border-[0.5px] border-border">
            {showPreview ? (
              <div
                className="markdown h-full overflow-auto p-[0.5em]"
                onDoubleClick={() => {
                  const currentScrollTop = editorRef.current?.getScrollTop?.() || 0
                  setShowPreview(false)
                  requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
                }}>
                <ReactMarkdown>{processedPrompt || instructions}</ReactMarkdown>
              </div>
            ) : (
              <CodeEditor
                value={instructions}
                language="markdown"
                onChange={setInstructions}
                height="100%"
                expanded={false}
                className="h-full"
              />
            )}
          </div>
        </div>
        <SpaceBetweenRowFlex className="mt-2.5 w-full justify-end">
          <div className="select-none rounded px-0.5 py-0.5 text-foreground-secondary text-sm">
            Tokens: {tokenCount}
          </div>
          <Button
            variant="default"
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
            {showPreview ? <Edit size={14} /> : <Save size={14} />}
            {showPreview ? t('common.edit') : t('common.save')}
          </Button>
        </SpaceBetweenRowFlex>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default PromptSettings
