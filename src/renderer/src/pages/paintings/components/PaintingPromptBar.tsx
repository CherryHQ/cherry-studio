import { Textarea } from '@cherrystudio/ui'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import type { FC, KeyboardEventHandler } from 'react'

interface PaintingPromptBarProps {
  prompt: string
  disabled: boolean
  placeholder: string
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
}

const PaintingPromptBar: FC<PaintingPromptBarProps> = ({
  prompt,
  disabled,
  placeholder,
  onPromptChange,
  onGenerate,
  onKeyDown
}) => {
  return (
    <div className="flex shrink-0 justify-center px-6 pt-2 pb-4">
      <div className="relative flex max-h-[120px] min-h-[88px] w-full max-w-[680px] flex-col rounded-[0.75rem] border border-border/50 bg-background shadow-black/5 shadow-lg">
        <Textarea.Input
          disabled={disabled}
          value={prompt}
          spellCheck={false}
          className="flex-1 resize-none border-0 bg-transparent px-4 pt-3 pb-1.5 text-[11px] text-foreground/80 shadow-none placeholder:text-muted-foreground/40 focus-visible:ring-0"
          placeholder={placeholder}
          onValueChange={onPromptChange}
          onKeyDown={onKeyDown}
        />
        <div className="flex h-10 flex-row items-center justify-end px-3 pb-2.5">
          <SendMessageButton sendMessage={onGenerate} disabled={disabled} />
        </div>
      </div>
    </div>
  )
}

export default PaintingPromptBar
