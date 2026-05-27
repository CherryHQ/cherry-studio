import { Textarea } from '@cherrystudio/ui'
import TranslateButton from '@renderer/components/TranslateButton'
import { cn } from '@renderer/utils'
import type { FC, KeyboardEventHandler, RefObject } from 'react'

import SendMessageButton from '../../home/Inputbar/SendMessageButton'

interface PaintingPromptBarProps {
  textareaRef?: RefObject<HTMLTextAreaElement | null>
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
      <Textarea.Input
        ref={textareaRef}
        className="resize-none! flex w-auto! flex-1 overflow-auto rounded-none border-0 p-2.5 focus-visible:border-0 focus-visible:ring-0"
        disabled={disabled}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
      />
      <div className={cn('flex h-10 shrink-0 flex-row items-center justify-end px-2 pb-1', footerClassName)}>
        <div
          className={cn(
            'flex h-8 flex-row items-center [&_.icon-ic_send]:mt-0! [&_.icon-ic_send]:mr-0! [&_.icon-ic_send]:flex [&_.icon-ic_send]:size-8 [&_.icon-ic_send]:items-center [&_.icon-ic_send]:justify-center [&_.icon-ic_send]:leading-none!',
            translate ? 'gap-1.5' : 'gap-2',
            actionsClassName
          )}>
          {translate && (
            <TranslateButton
              text={textareaRef?.current?.value}
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
