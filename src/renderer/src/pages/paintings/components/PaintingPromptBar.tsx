import { Textarea } from '@cherrystudio/ui'
import TranslateButton from '@renderer/components/TranslateButton'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import type { FC, KeyboardEventHandler } from 'react'

interface PaintingPromptBarProps {
  prompt: string
  disabled: boolean
  placeholder: string
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
  showTranslate?: boolean
  isTranslating?: boolean
  onTranslated?: (translatedText: string) => void
}

const PaintingPromptBar: FC<PaintingPromptBarProps> = ({
  prompt,
  disabled,
  placeholder,
  onPromptChange,
  onGenerate,
  onKeyDown,
  showTranslate = false,
  isTranslating = false,
  onTranslated
}) => {
  return (
    <div className="relative mx-5 mb-[15px] flex min-h-[95px] max-h-[95px] flex-col rounded-[10px] border border-[var(--color-border-soft)] transition-all">
      <Textarea.Input
        disabled={disabled}
        value={prompt}
        spellCheck={false}
        className="flex-1 resize-none border-0 bg-transparent p-[10px] shadow-none focus-visible:ring-0"
        placeholder={placeholder}
        onValueChange={onPromptChange}
        onKeyDown={onKeyDown}
      />
      <div className="flex h-10 flex-row justify-end px-2">
        <div className="flex flex-row items-center gap-[6px]">
          {showTranslate && onTranslated ? (
            <TranslateButton
              text={prompt}
              onTranslated={onTranslated}
              disabled={disabled || isTranslating}
              isLoading={isTranslating}
              style={{ marginRight: 6, borderRadius: '50%' }}
            />
          ) : null}
          <SendMessageButton sendMessage={onGenerate} disabled={disabled} />
        </div>
      </div>
    </div>
  )
}

export default PaintingPromptBar
