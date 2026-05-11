import 'emoji-picker-element'

import CloseCircleFilled from '@ant-design/icons/lib/icons/CloseCircleFilled'
import {
  Box,
  Button,
  CodeEditor,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  SpaceBetweenRowFlex,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import EmojiPicker from '@renderer/components/EmojiPicker'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useModelById } from '@renderer/hooks/useModels'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { SettingDivider } from '@renderer/pages/settings'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import type { UniqueModelId } from '@shared/data/types/model'
import { Input } from 'antd'
import { Edit, HelpCircle, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { estimateTokenCount } from 'tokenx'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings?: (settings: AssistantSettings) => void
  onOk?: () => void
}

const AssistantPromptSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const [emoji, setEmoji] = useState(getLeadingEmoji(assistant.name) || assistant.emoji)
  const [name, setName] = useState(assistant.name.replace(getLeadingEmoji(assistant.name) || '', '').trim())
  const [prompt, setPrompt] = useState(assistant.prompt)
  const [showPreview, setShowPreview] = useState(assistant.prompt.length > 0)
  const [tokenCount, setTokenCount] = useState(0)
  const { t } = useTranslation()
  const editorRef = useRef<RichEditorRef>(null)

  useEffect(() => {
    setTokenCount(estimateTokenCount(prompt))
  }, [prompt])

  const { model } = useModelById(assistant.modelId as UniqueModelId)
  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: model?.name
  })

  const onUpdate = () => {
    const _assistant = { ...assistant, name: name.trim(), emoji, prompt }
    updateAssistant(_assistant)
    window.toast.success(t('common.saved'))
  }

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

  const promptVarsContent = <pre>{t('assistants.presets.add.prompt.variables.tip.content')}</pre>

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Box className="mb-2 font-bold">{t('common.name')}</Box>
      <RowFlex className="items-center gap-2">
        <div className="hover:[&_.delete-icon]:!block relative inline-block">
          <Popover>
            <PopoverTrigger>
              <Button className="h-7 min-w-7 p-1 text-lg">{emoji}</Button>
            </PopoverTrigger>
            <PopoverContent>
              <EmojiPicker onEmojiClick={handleEmojiSelect} />
            </PopoverContent>
          </Popover>
          {emoji && (
            <CloseCircleFilled
              className="delete-icon z-50"
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
        </div>
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onUpdate}
          style={{ flex: 1 }}
        />
      </RowFlex>
      <SettingDivider />
      <RowFlex className="mb-2 items-center gap-1">
        <Box style={{ fontWeight: 'bold' }}>{t('common.prompt')}</Box>
        <Tooltip
          content={
            <>
              <h1 className="text-lg">{t('assistants.presets.add.prompt.variables.tip.title')}</h1>
              {promptVarsContent}
            </>
          }
          showArrow>
          <HelpCircle size={14} color="var(--color-text-2)" />
        </Tooltip>
      </RowFlex>
      <div className="relative w-full">
        <div className="h-[calc(80vh-202px)] overflow-hidden rounded-[5px] border-(--color-border) border-[0.5px] [&_.prompt-rich-editor]:h-full [&_.prompt-rich-editor]:border-none [&_.prompt-rich-editor_.rich-editor-content]:flex-1 [&_.prompt-rich-editor_.rich-editor-content]:overflow-auto [&_.prompt-rich-editor_.rich-editor-wrapper]:flex [&_.prompt-rich-editor_.rich-editor-wrapper]:h-full [&_.prompt-rich-editor_.rich-editor-wrapper]:flex-col">
          {showPreview ? (
            <div
              className="markdown h-full overflow-auto p-[0.5em]"
              onDoubleClick={() => {
                const currentScrollTop = editorRef.current?.getScrollTop?.() || 0
                setShowPreview(false)
                requestAnimationFrame(() => editorRef.current?.setScrollTop?.(currentScrollTop))
              }}>
              <ReactMarkdown>{processedPrompt || prompt}</ReactMarkdown>
            </div>
          ) : (
            <CodeEditor
              theme={activeCmTheme}
              fontSize={fontSize - 1}
              value={prompt}
              language="markdown"
              onChange={setPrompt}
              className="h-full"
              expanded={false}
              style={{
                height: '100%'
              }}
            />
          )}
        </div>
      </div>
      <SpaceBetweenRowFlex className="mt-2.5 w-full justify-end">
        <div className="select-none rounded px-0.5 py-0.5 text-(--color-text-2) text-sm">Tokens: {tokenCount}</div>
        <Button
          variant="default"
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
          {showPreview ? <Edit size={14} /> : <Save size={14} />}
          {showPreview ? t('common.edit') : t('common.save')}
        </Button>
      </SpaceBetweenRowFlex>
    </div>
  )
}

export default AssistantPromptSettings
