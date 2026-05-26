import TranslateButton from '@renderer/components/TranslateButton'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import TextArea from 'antd/es/input/TextArea'
import type { FC, KeyboardEventHandler, RefObject } from 'react'

import SendMessageButton from '../../home/Inputbar/SendMessageButton'

interface PaintingPromptBarProps {
  textareaRef?: RefObject<TextAreaRef | null>
  value?: string
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
  onGenerate: () => void | Promise<void>
  generateDisabled?: boolean
  footerClassName?: string
  actionsClassName?: string
  translate?: {
    onTranslated: (translatedText: string) => void
    disabled?: boolean
    isLoading?: boolean
  }
}

const PaintingPromptBar: FC<PaintingPromptBarProps> = ({
  textareaRef,
  value,
  disabled,
  placeholder,
  onChange,
  onKeyDown,
  onGenerate,
  generateDisabled,
  footerClassName,
  actionsClassName,
  translate
}) => {
  const isGenerateDisabled = generateDisabled ?? Boolean(disabled)

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') {
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      if (!isGenerateDisabled) {
        void onGenerate()
      }

      return
    }

    onKeyDown?.(event)
  }

  return (
    <div className="relative mx-5 mb-3.75 flex max-h-23.75 min-h-23.75 flex-col rounded-[10px] border border-border-subtle transition-all duration-300">
      <TextArea
        ref={textareaRef}
        className="resize-none! flex w-auto! flex-1 overflow-auto rounded-none p-2.5"
        variant="borderless"
        disabled={disabled}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
      />
      <div className={footerClassName ?? 'flex h-10 flex-row justify-end px-2 pb-0'}>
        <div className={actionsClassName ?? (translate ? 'flex flex-row items-center gap-1.5' : 'flex gap-2')}>
          {translate && (
            <TranslateButton
              text={textareaRef?.current?.resizableTextArea?.textArea?.value}
              onTranslated={translate.onTranslated}
              disabled={translate.disabled}
              isLoading={translate.isLoading}
              style={{ marginRight: 6, borderRadius: '50%' }}
            />
          )}
          <SendMessageButton sendMessage={onGenerate} disabled={isGenerateDisabled} />
        </div>
      </div>
    </div>
  )
}

export default PaintingPromptBar
